"""Rolling-window scoring-script lab (V2) for StockSimulate2026.

V2 of the scoring lab. Same reproducible, no-look-ahead discipline as V1
(tools/approved/scoring_lab.py) and the SAME scoring-script contract
(`score_universe(stocks, regime, ctx)`), but a materially better EVALUATION
framework. Four orthogonal changes vs V1:

  1. Rolling-window validation. Keep the four anchored 5-year windows (for
     continuity/reference) AND evaluate every rolling 5-year window at a monthly
     step across the whole history (~180 windows). Robustness is measured over
     the full set of regime start points, not four hand-picked ones.
  2. Dispersion is reference-only. Still reported (stddev of the rolling-window
     strategy gains), but NOT part of the ranking metric.
  3. Benchmark-relative scoring. Every window's strategy return is compared to a
     benchmark run with the SAME deposits, dates, dividends, and methodology.
     The benchmark is pluggable via --benchmark; until real SPY data lands the
     default is an in-panel cap-weight universe proxy (benchmark_code CAPW_UNIV),
     a clean drop-in for SPY later (--benchmark spy --benchmark-file spy.json).
  4. Equal weighting. Every rolling window contributes equally to the objective
     -- no hand-tuned recency weights.

Objective (the V2 leaderboard metric):

  relative_return = mean_over_rolling_windows( (1 + strat_gain) / (1 + bench_gain) )

  i.e. the equal-weighted average per-window growth-factor ratio of the strategy
  to the benchmark. 1.0 == matched the benchmark; > 1.0 == beat it. Per-window
  gain is the money-weighted annualized return (XIRR on the monthly deposit cash
  flows + ending value) -- the same metric `report build` and V1 use.

Why it is fast AND identical to a full rebalance backtest: the monthly ranking at
month-end d depends ONLY on d's cross-section (never on which window d falls in),
and a full monthly rebalance to fixed weights compounds exactly at the weighted
portfolio return. So we rank every calendar month ONCE, build a strategy NAV and a
benchmark NAV over the whole timeline, and each of the ~184 windows is then a
single-asset XIRR over its slice of the NAV -- mathematically the same result as
V1's cash-liquidate-rebuy engine, ~30x faster.

No look-ahead / no hindsight (unchanged from V1, reused verbatim):
  - Signals come only from the metrics panel, sliced `month_end <= checkpoint`.
  - Quarter-derived fundamentals are exposed only after a reporting lag.
  - The scoring script runs in a restricted namespace (no imports / files / net).
  - Ranking at month_end d uses d's own metrics and trades at d's close.

Usage:
    python3 scoring_lab_v2.py --script scoring_scripts/exp_001.py \
        [--benchmark capw|ew|spy] [--benchmark-file spy.json] \
        [--reporting-lag-days 60] [--top-n 15] [--rolling-years 5] \
        [--test-key exp_001] [--upsert] \
        [--lesson "..."] [--lesson-direction improve] [--parent-test-key exp_000] \
        [--out result.json]
"""
import argparse, bisect, json, math, os, statistics, subprocess, sys, time
import datetime as dt

# Reuse V1's audited building blocks so the point-in-time discipline stays identical. scoring_lab
# lives in the same tools dir (approved/); add our own dir so the import works whether this module
# is run directly or imported (e.g. by build_spy_benchmark).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scoring_lab as v1  # MetricsPanel, compute_regime, Ctx, load_script, xirr

# --- fixed harness policy (V2) ------------------------------------------------
BOUNDARY = "2026-06-26"
# Kept from V1 for continuity: reported alongside the rolling set, never the objective.
ANCHORED_WINDOWS = [
    ("2006-07-03", "2011-06-30"),
    ("2011-07-01", "2016-06-30"),
    ("2016-07-01", "2021-06-30"),
    ("2021-07-01", "2026-06-26"),
]
ROLLING_START_FLOOR = "2006-07-01"  # first eligible rolling-window start (anchored era)
ROLLING_YEARS = 5                   # every rolling window is this long

# Canonical, tracked home for shippable benchmark data (small + reusable, unlike the git-ignored
# metrics panel). The skill points here; drop real SPY at DEFAULT_SPY_FILE to replace the proxy.
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
DEFAULT_SPY_FILE = os.path.join(DATA_DIR, "spy_benchmark.json")


# Shift an ISO date by whole calendar years (clamped for Feb 29).
def _add_years(datestr, years):
    d = dt.date.fromisoformat(datestr)
    try:
        return d.replace(year=d.year + years).isoformat()
    except ValueError:
        return d.replace(year=d.year + years, day=28).isoformat()


# --- benchmark: a single total-return NAV series aligned to the timeline ------
# A benchmark is reduced to one price/NAV series so it plugs in identically whether
# it is a computed in-panel proxy or a real external SPY series. The window gain is
# then a single-asset XIRR over the same deposit schedule as the strategy.
class Benchmark:
    def __init__(self, code, nav_by_date):
        self.code = code
        self.nav = nav_by_date  # {month_end: level}

    def level(self, d):
        return self.nav.get(d)


# Cap-weight (or equal-weight) universe proxy NAV, compounded from the panel's own
# adj_close total returns with a monthly rebalance -- same dividends + methodology as
# the strategy. This is the interim stand-in for SPY (benchmark_code CAPW_UNIV/EW_UNIV).
def build_universe_benchmark(panel, cal, weighting):
    nav = {cal[0]: 1.0}
    prev_weights = None  # weights set at cal[k-1], realized over k-1 -> k
    # Cache the eligible-universe weights per month so we don't rebuild features twice.
    for k in range(1, len(cal)):
        d_prev, d = cal[k - 1], cal[k]
        if prev_weights is None:
            prev_weights = _universe_weights(panel, d_prev, weighting)
        growth = _portfolio_growth(panel, prev_weights, d_prev, d)
        nav[d] = nav[d_prev] * growth
        prev_weights = _universe_weights(panel, d, weighting)
    code = "EW_UNIV" if weighting == "ew" else "CAPW_UNIV"
    return Benchmark(code, nav)


# Minimum names carrying a (reporting-lagged) market cap before we cap-weight. Only ~30% of the
# universe has shares-outstanding coverage, but those are the larger names that dominate a cap
# index anyway, so cap-weighting that covered subset is a legitimate SPY-like proxy. Below this
# floor (very early history) we equal-weight so the benchmark is never built from a handful of names.
_MIN_CAPPED_NAMES = 30


# Weights over the eligible universe as-of d. For 'capw' we market-cap weight the names that carry a
# reporting-lagged market cap (a cap-weighted large-cap proxy for SPY); for 'ew', or when cap
# coverage is too thin, we equal-weight the whole eligible universe.
def _universe_weights(panel, d, weighting):
    rows = [f for f in (panel.features(s, d) for s in panel.symbols) if f is not None]
    if not rows:
        return []
    if weighting == "capw":
        capped = [(r["symbol"], r["market_cap"]) for r in rows
                  if r.get("market_cap") is not None and r["market_cap"] > 0]
        if len(capped) >= _MIN_CAPPED_NAMES:
            total = sum(c for _, c in capped)
            return [(s, c / total) for s, c in capped]
    # equal-weight fallback / EW mode
    w = 1.0 / len(rows)
    return [(r["symbol"], w) for r in rows]


# One month's gross return of a fixed-weight portfolio, using adj_close (which carries
# the last known price forward, so a name delisted mid-month contributes ~flat -- the
# same treatment as V1 liquidating a delisted holding at its last close). Renormalized
# over names with a valid price ratio so dropped names don't create phantom cash drag.
def _portfolio_growth(panel, weights, d_prev, d):
    num = 0.0
    wsum = 0.0
    for sym, w in weights:
        p0 = panel.adj_price(sym, d_prev)
        p1 = panel.adj_price(sym, d)
        if p0 and p1:
            num += w * (p1 / p0)
            wsum += w
    return (num / wsum) if wsum > 0 else 1.0


# Load an external benchmark NAV (e.g. real SPY total-return) from a JSON file shaped
# {"me": [month_end...], "price": [level...]} and align it to the timeline via as-of
# lookup (last level <= d), so it drops in exactly where the proxy sits.
def build_file_benchmark(path, cal, code):
    with open(path) as fh:
        raw = json.load(fh)
    me = raw["me"]
    px = raw.get("price") or raw.get("adj_close")
    # Honor a self-describing 'benchmark' label in the file (e.g. a proxy stand-in stamped
    # CAPW_UNIV_PROXY) so it can never be silently recorded as real SPY.
    code = raw.get("benchmark") or code
    nav = {}
    for d in cal:
        i = bisect.bisect_right(me, d) - 1
        if i >= 0 and i < len(px) and px[i]:
            nav[d] = float(px[i])
    # Guard against a benchmark file that ends before the panel does: recent windows would then
    # value the benchmark at a stale/flat carried-forward price. Warn loudly rather than mislead.
    if me and cal and me[-1] < cal[-1]:
        gap = (dt.date.fromisoformat(cal[-1]) - dt.date.fromisoformat(me[-1])).days
        if gap > 40:
            print(f"WARNING: benchmark file {os.path.basename(path)} ends {me[-1]} but the panel "
                  f"runs to {cal[-1]} ({gap}d gap) — recent windows use a stale benchmark. "
                  f"Regenerate it with build_spy_benchmark.py.", file=sys.stderr, flush=True)
    return Benchmark(code, nav)


# The universe proxy benchmark is script-INDEPENDENT and identical for every experiment, and
# building it is a full second per-month feature pass (~half the run). So compute it once, cache
# it to a {benchmark, me, price} file (same shape as the SPY file), and reuse it every run --
# auto-invalidating only when the panel changes (mtime) or the calendar extends past the cache.
def _benchmark_cache_path(args, code):
    if args.benchmark_cache:
        return args.benchmark_cache
    d = os.path.dirname(os.path.abspath(args.panel))
    return os.path.join(d, f"benchmark_{code.lower()}_lag{args.reporting_lag_days}.json")


def load_or_build_universe_benchmark(panel, cal, args):
    code = "EW_UNIV" if args.benchmark == "ew" else "CAPW_UNIV"
    path = _benchmark_cache_path(args, code)
    panel_mtime = os.path.getmtime(args.panel)
    if not args.rebuild_benchmark and os.path.exists(path):
        try:
            with open(path) as fh:
                raw = json.load(fh)
            nav = dict(zip(raw["me"], raw["price"]))
            # reuse only if it was built from THIS panel and covers the whole calendar
            if raw.get("panel_mtime") == panel_mtime and all(d in nav for d in cal):
                return Benchmark(raw.get("benchmark") or code, nav), path, True
        except (KeyError, ValueError, OSError):
            pass
    bench = build_universe_benchmark(panel, cal, args.benchmark)
    me = [d for d in cal if d in bench.nav]
    with open(path, "w") as fh:
        json.dump({"benchmark": bench.code, "panel_mtime": panel_mtime,
                   "me": me, "price": [bench.nav[d] for d in me]}, fh)
    return bench, path, False


# --- strategy: rank every calendar month once, build the strategy NAV ---------
# Returns (strat_nav, picks). strat_nav[d] is the monthly-rebalanced top-N NAV;
# picks is the per-month top-N selection recorded once over the full timeline
# (dedup: identical for every window that contains that month).
def build_strategy(panel, score_fn, cal, top_n):
    monthly_targets = {}  # d -> [(symbol, weight)]
    picks = []
    for d in cal:
        rows = [f for f in (panel.features(s, d) for s in panel.symbols) if f is not None]
        regime = v1.compute_regime(rows) if rows else {}
        targets = []
        if len(rows) >= top_n:
            scores = score_fn(rows, regime, v1.Ctx(rows, regime, d))
            eligible = {r["symbol"] for r in rows}
            ranked = sorted(
                ((s, sc) for s, sc in (scores or {}).items()
                 if s in eligible and isinstance(sc, (int, float)) and math.isfinite(sc)),
                key=lambda kv: kv[1], reverse=True,
            )[:top_n]
            m = len(ranked)
            raw = [m - i for i in range(m)]  # linear-decay rank weights
            tot = sum(raw) or 1
            for i, (sym, sc) in enumerate(ranked):
                w = raw[i] / tot
                targets.append((sym, w))
                picks.append({
                    "window_label": "timeline", "month_end": d, "rank": i + 1,
                    "symbol": sym, "score": round(float(sc), 6), "weight_pct": round(w * 100.0, 4),
                })
        monthly_targets[d] = targets

    nav = {cal[0]: 1.0}
    for k in range(1, len(cal)):
        d_prev, d = cal[k - 1], cal[k]
        growth = _portfolio_growth(panel, monthly_targets[d_prev], d_prev, d)
        nav[d] = nav[d_prev] * growth
    return nav, picks


# --- money-weighted annualized return over a window slice of a NAV series ------
# Same deposit schedule as V1: initial + monthly on the first month, monthly after.
# Buys NAV units with each deposit; XIRR on the deposits + ending value.
def window_gain(nav, cal_w, initial, monthly):
    if len(cal_w) < 6:
        return None
    units = 0.0
    flows = []
    for k, d in enumerate(cal_w):
        lvl = nav.get(d)
        if not lvl or lvl <= 0:
            continue
        deposit = (initial + monthly) if k == 0 else monthly
        units += deposit / lvl
        flows.append((d, -deposit))
    last = cal_w[-1]
    ending = units * (nav.get(last) or 0.0)
    flows.append((last, ending))
    return v1.xirr(flows) * 100.0  # annualized %


# Every rolling 5-year window (monthly step) whose full span fits before the boundary.
def rolling_windows(cal, years, floor):
    starts = [d for d in cal if d >= floor]
    out = []
    for s in starts:
        end_target = _add_years(s, years)
        if end_target > BOUNDARY:
            break
        cal_w = [d for d in cal if s <= d <= end_target]
        # require the window to actually span close to `years` (drop truncated tails)
        if len(cal_w) >= 6:
            span_days = (dt.date.fromisoformat(cal_w[-1]) - dt.date.fromisoformat(cal_w[0])).days
            if span_days >= (years - 0.25) * 365:
                out.append((cal_w[0], cal_w[-1]))
    # de-dup identical (start,end) pairs that can arise from month-end coalescing
    seen, uniq = set(), []
    for w in out:
        if w not in seen:
            seen.add(w)
            uniq.append(w)
    return uniq


# --- DB writes via the website PHP importers (V2 tables) ----------------------
def _php_importer(importer, payload):
    proc = subprocess.run(
        ["docker", "exec", "-i", "stock_report_php", "php",
         f"/var/www/html/data/importers/{importer}"],
        input=json.dumps(payload), capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"{importer} failed: {proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout.strip()


def _fetch_parent_relative(parent_test_key):
    if not parent_test_key:
        return None
    out = subprocess.run(
        ["docker", "exec", "-i", "stock_report_mysql", "mysql", "-ustock_user", "-pstock_pass",
         "stock_report", "--batch", "-N", "-e",
         f"SELECT relative_return FROM report_scoring_experiments_v2 WHERE test_key='{parent_test_key}'"],
        capture_output=True, text=True,
    )
    val = out.stdout.strip()
    try:
        return float(val) if val and val != "NULL" else None
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True, help="path to the scoring script (defines score_universe)")
    ap.add_argument("--panel", default=os.path.join(os.path.dirname(__file__), "..", "unapproved", "metrics_panel.json"))
    ap.add_argument("--test-key", dest="test_key", default=None, help="DB row key (default: script basename)")
    ap.add_argument("--top-n", dest="top_n", type=int, default=15)
    ap.add_argument("--rolling-years", dest="rolling_years", type=int, default=ROLLING_YEARS)
    ap.add_argument("--reporting-lag-days", dest="reporting_lag_days", type=int, default=60)
    ap.add_argument("--initial", type=int, default=200000)
    ap.add_argument("--monthly", type=int, default=2500)
    ap.add_argument("--benchmark", default="capw", choices=["capw", "ew", "spy"],
                    help="interim proxy (capw/ew) or real SPY series via --benchmark-file")
    ap.add_argument("--benchmark-file", dest="benchmark_file", default=DEFAULT_SPY_FILE,
                    help="JSON {me:[...],price:[...]} for --benchmark spy (default: tools/data/spy_benchmark.json)")
    ap.add_argument("--benchmark-cache", dest="benchmark_cache", default=None,
                    help="cache file for the capw/ew proxy (default: benchmark_<code>_lag<lag>.json next to panel)")
    ap.add_argument("--rebuild-benchmark", dest="rebuild_benchmark", action="store_true",
                    help="force-recompute the capw/ew proxy cache (use after regenerating the panel)")
    ap.add_argument("--upsert", action="store_true", help="write to report_scoring_experiments_v2")
    ap.add_argument("--lesson", default=None, help="learning text -> report_scoring_lessons_v2")
    ap.add_argument("--lesson-direction", dest="lesson_direction", default="neutral",
                    choices=["improve", "degrade", "neutral"])
    ap.add_argument("--parent-test-key", dest="parent_test_key", default=None)
    ap.add_argument("--out", default=None, help="also write the result JSON here")
    args = ap.parse_args()

    score_fn, meta = v1.load_script(args.script)
    args.test_key = args.test_key or os.path.splitext(os.path.basename(args.script))[0]

    panel = v1.MetricsPanel(args.panel, args.reporting_lag_days)
    cal = panel.calendar(ROLLING_START_FLOOR, BOUNDARY)
    print(f"Panel: {len(panel.symbols)} symbols, {len(cal)} month-ends. "
          f"Script: {meta['formula_name']} (variants={meta['logic_variant_count']}, "
          f"lag={args.reporting_lag_days}d, top{args.top_n})", flush=True)

    t0 = time.time()
    # 1) rank every month once -> strategy NAV + per-month picks
    strat_nav, picks = build_strategy(panel, score_fn, cal, args.top_n)
    # 2) benchmark NAV (same deposits/dates/dividends/methodology). SPY comes from a file;
    #    the capw/ew proxy is computed once and cached, then reused every run.
    if args.benchmark == "spy":
        if not args.benchmark_file or not os.path.exists(args.benchmark_file):
            raise SystemExit(f"--benchmark spy needs a benchmark file at {args.benchmark_file} — "
                             f"generate it with build_spy_benchmark.py (real SPY, or --source proxy).")
        bench = build_file_benchmark(args.benchmark_file, cal, "SPY")
        print(f"Built strategy in {time.time()-t0:.1f}s; loaded {bench.code} benchmark from "
              f"{os.path.basename(args.benchmark_file)}. Evaluating windows ...", flush=True)
    else:
        bench, cpath, cached = load_or_build_universe_benchmark(panel, cal, args)
        print(f"Built strategy in {time.time()-t0:.1f}s; "
              f"{'reused cached' if cached else 'built + cached'} {bench.code} benchmark "
              f"({os.path.basename(cpath)}). Evaluating windows ...", flush=True)

    # 3) score every window (rolling monthly-step + the 4 anchored), gain + ratio
    def evaluate(windows, tag):
        recs = []
        for s, e in windows:
            cal_w = [d for d in cal if s <= d <= e]
            sg = window_gain(strat_nav, cal_w, args.initial, args.monthly)
            bg = window_gain(bench.nav, cal_w, args.initial, args.monthly)
            if sg is None or bg is None:
                continue
            ratio = (1.0 + sg / 100.0) / (1.0 + bg / 100.0)
            recs.append({"start": s, "end": e, "tag": tag,
                         "strat_gain_pct": round(sg, 4), "bench_gain_pct": round(bg, 4),
                         "ratio": round(ratio, 6)})
        return recs

    rolling = evaluate(rolling_windows(cal, args.rolling_years, ROLLING_START_FLOOR), "rolling")
    anchored = evaluate(ANCHORED_WINDOWS, "anchored")
    if not rolling:
        raise SystemExit("no rolling windows evaluated -- check panel span")

    # 4) aggregate. Objective = equal-weighted mean ratio over ROLLING windows.
    ratios = [r["ratio"] for r in rolling]
    strat_gains = [r["strat_gain_pct"] for r in rolling]
    bench_gains = [r["bench_gain_pct"] for r in rolling]
    relative_return = statistics.mean(ratios)
    result = {
        "test_key": args.test_key,
        "formula_name": meta["formula_name"],
        "benchmark_code": bench.code,
        "rolling_step": "monthly",
        "rolling_window_count": len(rolling),
        "relative_return": round(relative_return, 6),                     # THE OBJECTIVE
        "relative_excess_pct": round((relative_return - 1.0) * 100.0, 4),  # convenience
        "mean_strategy_gain_pct": round(statistics.mean(strat_gains), 4),
        "mean_benchmark_gain_pct": round(statistics.mean(bench_gains), 4),
        "mean_excess_gain_pct": round(statistics.mean([s - b for s, b in zip(strat_gains, bench_gains)]), 4),
        "window_dispersion_pct": round(statistics.pstdev(strat_gains), 4),   # reference only
        "benchmark_win_rate_pct": round(100.0 * sum(1 for x in ratios if x > 1.0) / len(ratios), 4),  # reference
        "worst_window_ratio": round(min(ratios), 6),   # reference
        "best_window_ratio": round(max(ratios), 6),    # reference
        "logic_variant_count": meta["logic_variant_count"],
        "secs": round(time.time() - t0, 1),
    }
    # full per-window detail (rolling + the 4 anchored reference windows) for reproducibility &
    # future reference metrics -- the anchored gains live here, not in dedicated columns.
    windows_json = {"rolling": rolling, "anchored": anchored}

    print(f"  rolling windows : {len(rolling)}  (monthly step, {args.rolling_years}y each)", flush=True)
    print(f"  relative_return : {relative_return:.4f}x  "
          f"(excess {result['relative_excess_pct']:+.2f}%, win-rate {result['benchmark_win_rate_pct']:.1f}%)", flush=True)
    print(f"  mean strat/bench: {result['mean_strategy_gain_pct']:.2f}% / "
          f"{result['mean_benchmark_gain_pct']:.2f}%  (dispersion {result['window_dispersion_pct']:.2f}%, ref)", flush=True)
    for r in anchored:
        print(f"    anchored {r['start']}..{r['end']}: strat {r['strat_gain_pct']:6.2f}%  "
              f"bench {r['bench_gain_pct']:6.2f}%  ratio {r['ratio']:.3f}", flush=True)
    print("RESULT " + json.dumps(result), flush=True)

    if args.out:
        with open(args.out, "w") as fh:
            json.dump({**result, "windows": windows_json}, fh, indent=2)

    if args.upsert:
        _php_importer("report_scoring_experiment_v2_upsert.php", {
            **{k: v for k, v in result.items() if k != "secs"},
            "scoring_definition": meta["source"],
            "definition_format": "python",
            "rolling_windows_json": json.dumps(windows_json, separators=(",", ":")),
            "notes": meta.get("notes") or "",
        })
        print(f"Upserted experiment {args.test_key} (relative_return {relative_return:.4f}x).", flush=True)
        _php_importer("report_scoring_picks_v2_replace.php", {
            "test_key": args.test_key, "picks": picks,
        })
        print(f"Recorded {len(picks)} monthly pick(s) for {args.test_key}.", flush=True)

    if args.lesson:
        parent_r = _fetch_parent_relative(args.parent_test_key)
        delta = round(relative_return - parent_r, 6) if parent_r is not None else None
        evidence = args.test_key + (f",{args.parent_test_key}" if args.parent_test_key else "")
        _php_importer("report_scoring_lesson_v2_insert.php", {
            "lesson": args.lesson,
            "direction": args.lesson_direction,
            "metric": "relative_return",
            "metric_delta": delta,
            "parent_test_key": args.parent_test_key,
            "evidence_test_keys": evidence,
            "regime_context": (f"{len(rolling)} rolling {args.rolling_years}y windows vs {bench.code}; "
                               f"mean strat {result['mean_strategy_gain_pct']:.1f}% / "
                               f"bench {result['mean_benchmark_gain_pct']:.1f}%"),
        })
        print("Appended lesson to report_scoring_lessons_v2.", flush=True)


if __name__ == "__main__":
    main()
