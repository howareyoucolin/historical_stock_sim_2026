#!/usr/bin/env python3
"""Headless supervisor for the V2 scoring-script autopilot — a hard, restartable orchestrator.

Everything mechanical lives here so the loop can run unattended for days and be managed by
watchdog.sh (WORKER_CMD='python3 run_autopilot.py --loop'):

  study feed -> decide mode (2:1 exploit:explore) -> pick parent/family -> GENERATE next script
  -> validate + dedupe -> backtest (scoring_lab_v2.py) -> compose+insert lesson -> publish -> log

The ONE creative step (writing the next scoring script) is delegated to a pluggable generator:
  --generator codex   : headless Codex (`codex exec`) — hybrid; keeps the AI's novelty. (default)
  --generator mutate  : built-in deterministic parameter variation — no AI, pure sweep; the
                        testable fallback. Also runs with zero cost if you don't want the AI.

Robustness: per-step subprocess timeouts, retry-then-skip, resume (numbering derived from the feed
+ local scripts so a crash never repeats or collides), and an alog() heartbeat at every step (which
the watchdog reads for staleness and /logs.php shows remotely).

Usage:
  python3 run_autopilot.py --once                       # one iteration (default generator: codex)
  python3 run_autopilot.py --loop                       # forever (until stopped)
  python3 run_autopilot.py --loop --max-iters 50
  python3 run_autopilot.py --once --generator mutate --feed-url http://localhost:8700/experiments-feed-v2.php --dry-run
  WORKER_CMD='python3 tools/approved/run_autopilot.py --loop' tools/approved/watchdog.sh   # self-healing
"""
import argparse, hashlib, json, os, re, subprocess, sys, time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scoring_lab as v1     # load_script (contract validation)
import alog                  # heartbeat logger

SIM_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SCRIPTS_DIR = os.path.join(SIM_ROOT, "tools", "unapproved", "scoring_scripts")
SCORING_LAB = os.path.join(HERE, "scoring_lab_v2.py")
WEBSITE_ROOT = os.path.abspath(os.path.join(SIM_ROOT, "..", "stock_report_website"))
PUBLISH_SH = os.path.join(WEBSITE_ROOT, "deploy", "publish_scoring_results_v2.sh")
PHP_CONTAINER = "stock_report_php"

PROD_FEED = "https://stock.369usa.com/experiments-feed-v2.php"

# Explore archetypes rotated through when no untried family is obvious (kept in sync with the skill).
ARCHETYPES = ["mean-reversion", "deep-value", "low-vol-quality", "dividend-income",
              "breadth-regime", "contrarian-52w", "small-cap"]


def now_iso():
    # local wall-clock string for log messages (avoids importing datetime formatting elsewhere)
    return time.strftime("%Y-%m-%d %H:%M:%S")


def log(msg, level="info", test_key=None):
    alog.log(msg, level=level, source="autopilot", test_key=test_key)
    print(f"[{now_iso()}] {level.upper()} {msg}", flush=True)


# --- feed -------------------------------------------------------------------
def fetch_feed(url):
    with urllib.request.urlopen(url + "?view=full&limit=500", timeout=30) as r:
        return json.loads(r.read().decode())


def notes_tag(exp):
    line = ((exp.get("notes") or "").splitlines() or [""])[0]
    mode = "explore" if "mode=explore" in line else ("exploit" if "mode=exploit" in line else None)
    fam = None
    m = re.search(r"family=([A-Za-z0-9_-]+)", line)
    if m:
        fam = m.group(1)
    return mode, fam


# --- deterministic decisions -----------------------------------------------
# 2:1 exploit:explore, measured from the 12 most-recent experiments (skill rule).
def decide_mode(exps):
    recent = sorted(exps, key=lambda e: str(e.get("createdAt") or e.get("updatedAt") or ""), reverse=True)[:12]
    if not recent:
        return "explore"  # empty board: seed with an explore
    explore = sum(1 for e in recent if notes_tag(e)[0] == "explore")
    return "explore" if explore < len(recent) / 3.0 else "exploit"


def champion(exps, benchmark_code):
    pool = [e for e in exps if e.get("benchmarkCode") == benchmark_code and e.get("relativeReturn") is not None]
    return max(pool, key=lambda e: e["relativeReturn"]) if pool else None


def pick_family(mode, exps, parent):
    if mode == "exploit" and parent:
        return notes_tag(parent)[1] or "regime-momentum-quality-value"
    tried = {notes_tag(e)[1] for e in exps if notes_tag(e)[1]}
    untried = [a for a in ARCHETYPES if a not in tried]
    return untried[0] if untried else min(ARCHETYPES, key=lambda a: sum(1 for e in exps if notes_tag(e)[1] == a))


def next_exp_num(exps):
    nums = [0]
    for e in exps:
        m = re.match(r"exp_(\d+)", str(e.get("testKey") or ""))
        if m:
            nums.append(int(m.group(1)))
    if os.path.isdir(SCRIPTS_DIR):
        for f in os.listdir(SCRIPTS_DIR):
            m = re.match(r"exp_(\d+)_.*\.py$", f)
            if m:
                nums.append(int(m.group(1)))
    return max(nums) + 1


# --- dedupe (mirror of the skill's logic fingerprint) ----------------------
def fingerprint(src):
    keep = []
    for ln in src.splitlines():
        s = ln.strip()
        if not s or s.startswith("#") or s.startswith("FORMULA_NAME") or s.startswith("NOTES"):
            continue
        keep.append(re.sub(r"\s+", " ", s))
    return hashlib.sha256("\n".join(keep).encode()).hexdigest()


def feed_fingerprints(exps):
    return {fingerprint(e.get("scoringDefinition") or "") for e in exps if e.get("scoringDefinition")}


# --- generators -------------------------------------------------------------
# mutate: emit a valid, self-contained, fingerprint-unique script from a template, weights varied
# deterministically by exp number. No AI — this is the pure-sweep path (and what CI/tests use).
_MUTATE_TEMPLATES = {
    "regime-momentum-quality-value": (2, """
BULL = {{"momentum_12_1_pct": ({a}, +1), "return_6m_pct": ({b}, +1), "eps_growth_pct": ({c}, +1),
        "free_cash_flow_margin_pct": ({d}, +1), "forward_pe": ({e}, -1), "peg": ({f}, -1)}}
RISK_OFF = {{"realized_vol_3m": ({g}, -1), "free_cash_flow_margin_pct": ({d}, +1),
            "operating_margin_pct": (0.10, +1), "forward_pe": ({e}, -1), "peg": ({f}, -1),
            "from_200d_ma_pct": (0.10, +1), "momentum_12_1_pct": (0.05, +1)}}
def score_universe(stocks, regime, ctx):
    book = BULL if regime.get("bull") else RISK_OFF
    z = {{m: ctx.z(m) for m in book}}
    out = {{}}
    for r in stocks:
        s = 0.0
        for m, (w, sign) in book.items():
            v = z[m].get(r["symbol"])
            if v is not None:
                s += w * sign * v
        out[r["symbol"]] = s
    return out
"""),
    "mean-reversion": (1, """
BOOK = {{"return_1m_pct": ({a}, -1), "return_3m_pct": ({b}, -1), "from_200d_ma_pct": ({c}, -1),
        "free_cash_flow_margin_pct": ({d}, +1)}}
def score_universe(stocks, regime, ctx):
    z = {{m: ctx.z(m) for m in BOOK}}
    out = {{}}
    for r in stocks:
        s = 0.0
        for m, (w, sign) in BOOK.items():
            v = z[m].get(r["symbol"])
            if v is not None:
                s += w * sign * v
        out[r["symbol"]] = s
    return out
"""),
    "low-vol-quality": (1, """
BOOK = {{"realized_vol_3m": ({a}, -1), "free_cash_flow_margin_pct": ({b}, +1),
        "operating_margin_pct": ({c}, +1), "from_200d_ma_pct": ({d}, +1)}}
def score_universe(stocks, regime, ctx):
    z = {{m: ctx.z(m) for m in BOOK}}
    out = {{}}
    for r in stocks:
        s = 0.0
        for m, (w, sign) in BOOK.items():
            v = z[m].get(r["symbol"])
            if v is not None:
                s += w * sign * v
        out[r["symbol"]] = s
    return out
"""),
}


def gen_mutate(mode, family, parent, lessons, target, exp_num):
    tmpl_key = family if family in _MUTATE_TEMPLATES else (
        "regime-momentum-quality-value" if mode == "exploit" else "mean-reversion")
    variants, body = _MUTATE_TEMPLATES[tmpl_key]
    # deterministic per-exp weight jitter so each run is a distinct, valid point in the space
    j = ((exp_num * 7) % 11 - 5) / 100.0
    w = {"a": round(0.35 + j, 3), "b": round(0.20 - j, 3), "c": round(0.20, 3), "d": round(0.15, 3),
         "e": round(0.08, 3), "f": round(0.07, 3), "g": round(0.30 + j, 3)}
    filled = body.format(**w)
    src = (f'# Auto-generated (mutate) exp_{exp_num:03d} — {tmpl_key} sweep point.\n'
           f'FORMULA_NAME = "{tmpl_key} (mutate v{exp_num})"\n'
           f'LOGIC_VARIANT_COUNT = {variants}\n'
           f'NOTES = "mode={mode}; family={family}. Auto (mutate); weight jitter j={j}."\n'
           + filled)
    with open(target, "w") as fh:
        fh.write(src)
    return True


def gen_codex(mode, family, parent, lessons, target, exp_num, generator_cmd, timeout, message=""):
    parent_src = (parent or {}).get("scoringDefinition") or ""
    lesson_txt = "\n".join(f"- ({l.get('direction')}) {l.get('text')}" for l in lessons[:12])
    directive = (f"\n*** OPERATOR DIRECTIVE for this run (HIGHEST PRIORITY — skew the script toward "
                 f"this focus, within the mode/contract below): {message} ***\n" if message else "")
    prompt = f"""You are running scoring-script-autopilot-v2. Write ONE new Python scoring script.
{directive}
Mode: {mode}. Family: {family}. Next id: exp_{exp_num:03d}.
Parent (champion) test_key: {(parent or {}).get('testKey')}, relative_return {(parent or {}).get('relativeReturn')}.

Follow the contract in .claude/skills/scoring-script-autopilot-v2/SKILL.md exactly:
- define score_universe(stocks, regime, ctx) -> {{symbol: score}}; restricted namespace (no imports/IO).
- set LOGIC_VARIANT_COUNT to the true number of regime branches.
- FIRST line of NOTES must be: mode={mode}; family={family}
- {'EXPLOIT: ONE targeted, attributable change within the parent family below.' if mode=='exploit' else 'EXPLORE: a structurally NEW idea for the '+family+' archetype, unlike the parent.'}
- Metric-coverage rule: consider the FULL metric menu in the skill (momentum, trend/recovery, vol,
  liquidity, income, valuation, growth, quality, size). Using only a few is fine, but weight-0 the
  rest DELIBERATELY — don't default to the same 4-5. Do NOT assume an untried metric is useless;
  rotate which metrics you use across runs so the backtest can prove or kill each. Beware correlated
  metrics (return/momentum/distance are one bet; pe/forward_pe/peg are one bet) and sparse
  fundamentals (~30% coverage tilts toward large caps).

Recent lessons (learn from these; do not repeat degrade lessons):
{lesson_txt or '(none yet)'}

{'Parent script to build on:' if mode=='exploit' else 'Parent script (for contrast — be structurally different):'}
{parent_src}

Write the COMPLETE file to: {target}
Output only the file. Do not run anything else."""
    tmp = target + ".prompt.txt"
    with open(tmp, "w") as fh:
        fh.write(prompt)
    env = dict(os.environ, AUTOPILOT_PROMPT_FILE=tmp, AUTOPILOT_TARGET=target)
    try:
        if os.path.exists(target):
            os.remove(target)
        proc = subprocess.run(generator_cmd, shell=True, cwd=SIM_ROOT, env=env,
                              capture_output=True, text=True, timeout=timeout)
        if proc.returncode != 0:
            log(f"generator exited {proc.returncode}: {(proc.stderr or proc.stdout)[:200]}", "warn")
        return os.path.exists(target) and os.path.getsize(target) > 0
    except subprocess.TimeoutExpired:
        log(f"generator timed out after {timeout}s", "warn")
        return False
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


# --- backtest / lesson / publish -------------------------------------------
def run_backtest(script_path, test_key, parent_key, benchmark, timeout):
    out_json = os.path.join(SIM_ROOT, "tools", "unapproved", f"{test_key}_v2_result.json")
    cmd = ["python3", SCORING_LAB, "--script", script_path, "--test-key", test_key,
           "--benchmark", benchmark, "--upsert", "--out", out_json]
    if parent_key:
        cmd += ["--parent-test-key", parent_key]
    proc = subprocess.run(cmd, cwd=SIM_ROOT, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[-300:])
    with open(out_json) as fh:
        return json.load(fh)


def insert_lesson(result, parent, mode, family):
    new_rel = result.get("relative_return")
    p_rel = (parent or {}).get("relativeReturn")
    delta = round(new_rel - p_rel, 6) if (new_rel is not None and p_rel is not None) else None
    direction = "neutral" if not delta else ("improve" if delta > 0 else "degrade")
    text = (f"{mode}/{family}: relative_return {new_rel:.4f}x"
            + (f" (delta {delta:+.4f} vs {parent['testKey']})" if delta is not None else "")
            + f"; win-rate {result.get('benchmark_win_rate_pct')}%,"
            + f" worst-window {result.get('worst_window_ratio')}, dispersion {result.get('window_dispersion_pct')}%.")
    payload = {"lesson": text, "direction": direction, "metric": "relative_return",
               "metric_delta": delta, "parent_test_key": (parent or {}).get("testKey"),
               "evidence_test_keys": result["test_key"] + (f",{parent['testKey']}" if parent else ""),
               "regime_context": f"auto/{mode}; benchmark {result.get('benchmark_code')}"}
    proc = subprocess.run(
        ["docker", "exec", "-i", PHP_CONTAINER, "php",
         "/var/www/html/data/importers/report_scoring_lesson_v2_insert.php"],
        input=json.dumps(payload), capture_output=True, text=True)
    if proc.returncode != 0:
        log(f"lesson insert failed: {(proc.stderr or proc.stdout).strip()[:150]}", "warn")
    return direction, delta


def publish(test_key, timeout):
    proc = subprocess.run(["bash", PUBLISH_SH, test_key], cwd=WEBSITE_ROOT,
                          capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[-200:])


# --- one iteration ----------------------------------------------------------
def iterate(args):
    log("iter start: studying feed")
    feed = fetch_feed(args.feed_url)
    exps = feed.get("experiments", [])
    lessons = feed.get("lessons", [])
    mode = decide_mode(exps)
    parent = champion(exps, args.benchmark_code)
    family = pick_family(mode, exps, parent)
    # mutate only has a few templates; snap to one so the recorded family matches the real logic
    # (codex honors the chosen family, so this only applies to the no-AI sweep path).
    if args.generator == "mutate" and family not in _MUTATE_TEMPLATES:
        family = "regime-momentum-quality-value" if mode == "exploit" else "mean-reversion"
    exp_num = next_exp_num(exps)
    # --test-key overrides automatic numbering (e.g. a fixed 'exp_dryrun' for repeatable tests: it
    # doesn't match exp_<n> so it never consumes a real number or bumps the counter).
    test_key = args.test_key or f"exp_{exp_num:03d}"
    slug = re.sub(r"[^a-z0-9]+", "_", family.lower()).strip("_")
    target = os.path.join(SCRIPTS_DIR, f"{test_key}_{slug}.py")
    os.makedirs(SCRIPTS_DIR, exist_ok=True)
    seen = feed_fingerprints(exps)
    log(f"{test_key}: mode={mode} family={family} parent={(parent or {}).get('testKey')}", test_key=test_key)

    # generate (retry until valid + unique, else skip)
    ok = False
    for attempt in range(1, args.gen_retries + 1):
        if args.generator == "mutate":
            gen_mutate(mode, family, parent, lessons, target, exp_num + attempt - 1)
        else:
            log(f"generating {test_key} via codex (attempt {attempt}/{args.gen_retries})", test_key=test_key)
            if not gen_codex(mode, family, parent, lessons, target, exp_num, args.generator_cmd,
                             args.gen_timeout, args.message):
                log(f"generation attempt {attempt} produced no file", "warn", test_key)
                continue
        try:
            v1.load_script(target)  # contract check (defines score_universe)
        except SystemExit as e:
            log(f"attempt {attempt} invalid script: {e}", "warn", test_key)
            continue
        if fingerprint(open(target).read()) in seen:
            log(f"attempt {attempt} is a duplicate; regenerating", "warn", test_key)
            continue
        ok = True
        break
    if not ok:
        log(f"{test_key}: could not generate a valid unique script in {args.gen_retries} tries; skipping", "error", test_key)
        if os.path.exists(target):
            os.remove(target)
        return False

    # backtest (retry then skip)
    result = None
    for attempt in range(1, args.bt_retries + 1):
        try:
            result = run_backtest(target, test_key, (parent or {}).get("testKey"), args.benchmark, args.bt_timeout)
            break
        except (subprocess.TimeoutExpired, RuntimeError) as e:
            log(f"backtest attempt {attempt} failed: {str(e)[:200]}", "warn", test_key)
            time.sleep(args.retry_sleep * attempt)
    if result is None:
        log(f"{test_key}: backtest failed after {args.bt_retries} tries; skipping", "error", test_key)
        return False
    direction, delta = insert_lesson(result, parent, mode, family)
    log(f"backtested {test_key}: relative_return {result['relative_return']:.4f}x "
        f"({'Δ '+format(delta,'+.4f') if delta is not None else 'no parent'}, {direction}); "
        f"win {result['benchmark_win_rate_pct']}%", test_key=test_key)

    # publish (best-effort; result is already safe locally)
    if args.dry_run:
        log(f"{test_key}: --dry-run, skipping publish", test_key=test_key)
    else:
        try:
            publish(test_key, args.publish_timeout)
            log(f"published {test_key} to prod", test_key=test_key)
        except (subprocess.TimeoutExpired, RuntimeError) as e:
            log(f"{test_key}: publish failed (kept locally): {str(e)[:150]}", "warn", test_key)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", action="store_true", help="run forever (until stopped)")
    ap.add_argument("--once", action="store_true", help="run a single iteration")
    ap.add_argument("--max-iters", dest="max_iters", type=int, default=0, help="stop after N iterations (0=unlimited)")
    ap.add_argument("--generator", choices=["codex", "mutate"], default="codex")
    ap.add_argument("--generator-cmd", dest="generator_cmd",
                    default='codex exec --ephemeral -s workspace-write "$(cat "$AUTOPILOT_PROMPT_FILE")"',
                    help="shell command for --generator codex; must write the file to $AUTOPILOT_TARGET. "
                         "Default is headless full-auto sandboxed to the workspace. For unsandboxed "
                         "full-auto use --dangerously-bypass-approvals-and-sandbox instead of -s.")
    ap.add_argument("--benchmark", default="spy", choices=["spy", "capw", "ew"])
    ap.add_argument("--benchmark-code", dest="benchmark_code", default="CAPW_UNIV",
                    help="benchmark_code to compare the champion within (must match what --benchmark produces)")
    ap.add_argument("--test-key", dest="test_key", default=None,
                    help="override auto-numbering with a fixed key (e.g. exp_dryrun for repeatable tests)")
    ap.add_argument("--message", default=os.environ.get("AUTOPILOT_MESSAGE", "").strip(),
                    help="operator steering directive injected into the codex generation prompt so "
                         "the run skews toward a focus (e.g. --message 'focus on low-vol dividend names'). "
                         "Defaults to $AUTOPILOT_MESSAGE. Only affects --generator codex (mutate ignores it).")
    ap.add_argument("--feed-url", dest="feed_url", default=PROD_FEED)
    ap.add_argument("--dry-run", dest="dry_run", action="store_true", help="skip publish to prod")
    ap.add_argument("--sleep", type=int, default=5, help="seconds between iterations in --loop")
    ap.add_argument("--gen-retries", dest="gen_retries", type=int, default=3)
    ap.add_argument("--gen-timeout", dest="gen_timeout", type=int, default=600)
    ap.add_argument("--bt-retries", dest="bt_retries", type=int, default=2)
    ap.add_argument("--bt-timeout", dest="bt_timeout", type=int, default=300)
    ap.add_argument("--publish-timeout", dest="publish_timeout", type=int, default=300)
    ap.add_argument("--retry-sleep", dest="retry_sleep", type=int, default=15)
    args = ap.parse_args()

    if not args.loop and not args.once:
        args.once = True

    log(f"supervisor online (generator={args.generator}, benchmark={args.benchmark}, "
        f"feed={'prod' if args.feed_url == PROD_FEED else args.feed_url}, dry_run={args.dry_run})")
    if args.message:
        log(f"operator focus this run: {args.message}"
            + ("" if args.generator == "codex" else "  (note: ignored by --generator mutate)"), "info")
    n = 0
    while True:
        n += 1
        try:
            iterate(args)
        except Exception as e:  # never let one iteration kill the loop
            log(f"iteration error: {type(e).__name__}: {str(e)[:200]}", "error")
        if args.once or (args.max_iters and n >= args.max_iters):
            break
        time.sleep(args.sleep)
    log(f"supervisor stopping after {n} iteration(s)")


if __name__ == "__main__":
    main()
