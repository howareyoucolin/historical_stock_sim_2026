---
name: scoring-script-autopilot-v2
description: Autonomously invent and test regime-aware stock-scoring SCRIPTS (Python, with branching logic like "if bull market, weight momentum more") under the V2 evaluation framework, then loop. V2 evaluates every rolling 5-year window (monthly step) plus the four anchored windows, scores each window RELATIVE TO A BENCHMARK run with identical deposits/dates/dividends/methodology, weights every window equally, and reports dispersion for reference only. Optimizes relative_return = mean over rolling windows of (1+strategy)/(1+benchmark). Use when the user wants the V2 self-driving scoring-script lab, rolling-window / benchmark-relative scoring exploration, or "find a better scoring rule under V2". The former V1 (scoring-script-autopilot) optimized justified_gain over four hand-weighted windows; it has been retired (removed from active skills), though its historical data is preserved for reference.
---

# Scoring Script Autopilot V2

Run an unattended search for the best **monthly stock-scoring SCRIPT**, evaluated by a
materially better framework than V1. A script may still branch on the market regime (e.g.
*if bull: weight momentum more; if risk-off: favor low-vol quality/value*). Each iteration the
agent studies what has been tried and learned, writes a **new or improved Python script**,
backtests it, and records both the numbers and a **lesson** about what moved the objective.

This is **research**, not discretionary trading. Every candidate is reproducible: the exact
script text is stored in the DB, so any row can be re-run and re-scored.

## What V2 changes vs V1 (four orthogonal changes)

1. **Rolling-window validation.** Keep the four anchored 5-year windows (reference/continuity)
   AND evaluate **every rolling 5-year window at a monthly step** (~180 windows) across the
   whole history. Robustness is measured over the full set of regime start points.
2. **Dispersion is reference-only.** Still reported (stddev of the rolling strategy gains), but
   **removed from the ranking metric**.
3. **Benchmark-relative scoring.** Every window's strategy return is compared to a **benchmark**
   run with the SAME deposits, dates, dividends, and methodology. Until real SPY data lands the
   benchmark is an in-panel **cap-weight universe proxy** (`benchmark_code = CAPW_UNIV`); it is a
   clean drop-in for real SPY later (see *Benchmark* below).
4. **Equal weighting.** Every rolling window contributes **equally** to the objective — no
   hand-tuned recency weights.

The variable under test is still the SCRIPT. The evaluation harness (windows, sizing, funding,
benchmark, objective) is fixed policy — change it only if the user explicitly asks.

## Hard rules

- **No look-ahead, no hindsight — top priority.** Enforced structurally (V2 reuses V1's audited
  point-in-time engine verbatim):
  - Signals come only from `tools/unapproved/metrics_panel.json`, sliced `month_end <= checkpoint`.
  - Quarter-derived fundamentals (incl. `forward_eps`/`forward_pe`/`peg`) are exposed only after a
    **reporting lag** (default 60 days) past `fiscal_quarter`.
  - The scoring script runs in a **restricted namespace** (no imports / files / network).
  - Ranking at month_end d uses d's own metrics and trades at d's close.
  - Scripts must be **mechanical**: a stock's score is a function of observable metrics, never of a
    ticker's known future (the same function scores all ~950 names).
- **Fixed evaluation harness (do not change without the user's say-so).** Every script is scored
  on exactly these, so results stay comparable:
  - **Windows:** all rolling **5-year windows at a monthly step** (the objective set) + the four
    anchored windows `2006-07-03..2011-06-30`, `2011-07-01..2016-06-30`, `2016-07-01..2021-06-30`,
    `2021-07-01..2026-06-26` (reported for continuity only).
  - **Per-window gain:** money-weighted annualized return (XIRR on the monthly deposit cash flows +
    ending value — the same metric `report build` and V1 use).
  - **Sizing:** rank the full universe, **hold the top 15**, **linear-decay** rank weights
    (rank 1 ≈ 12.5% … rank 15 ≈ 0.8%), full monthly rebalance, fractional shares, no fees.
  - **Funding:** `$200,000` initial + `$2,500` each month.
  - **Benchmark:** same sizing-agnostic passive portfolio run with the **same deposits/dates/
    dividends/methodology** (cap-weight universe proxy until real SPY; `benchmark_code` records it).
  - **Objective (the V2 leaderboard metric):**
    `relative_return = mean over rolling windows of (1 + strat_gain) / (1 + bench_gain)`,
    equal-weighted. `1.0` == matched the benchmark; `> 1.0` == beat it.
  - **Reference-only (reported, NEVER ranked):** `window_dispersion_pct` (stddev of rolling strat
    gains), `benchmark_win_rate_pct` (% of windows with ratio > 1), `worst/best_window_ratio`,
    the four anchored-window gains, and `mean_strategy_gain_pct` / `mean_benchmark_gain_pct`.
- **The SCRIPT is the only variable.** Sizing/windows/funding/benchmark/objective are harness
  policy. A run tells you whether the *ranking logic* worked, nothing else.
- **Compare like with like.** Only compare `relative_return` across experiments that share the
  same `benchmark_code`. When real SPY replaces the proxy, that is a new benchmark generation —
  do not rank SPY-benchmarked scripts against CAPW_UNIV-benchmarked ones.
- **Every run is recorded.** `--upsert` writes three V2 tables: the result to
  `report_scoring_experiments_v2` (keyed on `test_key`), the monthly **top-15 picks** to
  `report_scoring_experiment_picks_v2` (recorded ONCE over the whole timeline — the ranking at a
  month_end is identical for every window containing it), and a `report_scoring_lessons_v2` row
  when `--lesson` is given.
- **Production is the system of record — learn from it, and always publish to it.** The local DB
  is a scratch pad; after every run you MUST publish with the website `publish-scoring-results-v2`
  skill (`./deploy/publish_scoring_results_v2.sh <test_key>`), and you MUST start each iteration by
  reading the **production V2 feed** (step 1) — not the local DB.

## The scoring-script contract (identical to V1)

Each script is a file under `tools/unapproved/scoring_scripts/` defining:

```python
FORMULA_NAME = "..."          # human label (optional; defaults to filename)
LOGIC_VARIANT_COUNT = 2       # number of distinct regime branches (=> DB column)
NOTES = "..."                 # short description (optional; FIRST line carries mode/family tag)

def score_universe(stocks, regime, ctx):
    # stocks : list[dict] — one point-in-time row per eligible stock (fields below)
    # regime : {'bull','breadth','avg_realized_vol_3m','median_momentum_12_1_pct',
    #           'median_from_200d_ma_pct','universe_size'}
    # ctx    : ctx.z(metric) -> {symbol: cross-sectional z or None}; ctx.regime; ctx.date
    # return : {symbol: score}  (higher = better; the runner holds the top 15)
    ...
```

### The full metric menu (point-in-time; fundamentals reporting-lagged)

Every metric below is available on each `stocks` row and via `ctx.z(metric)`. They are grouped by
the signal they carry:

- **Momentum / return:** `return_1m_pct`, `return_3m_pct`, `return_6m_pct`, `return_12m_pct`,
  `momentum_12_1_pct`
- **Trend / recovery (distance):** `from_200d_ma_pct`, `from_52w_high_pct`
- **Volatility / risk:** `realized_vol_3m`
- **Liquidity:** `avg_daily_volume_3m`, `avg_daily_dollar_volume_3m`, `trading_days_3m`
- **Income:** `dividend_yield_ttm_pct`, `dividend_ttm`
- **Valuation (ratios):** `pe`, `forward_pe`, `peg`
- **Growth:** `eps_growth_pct`, `revenue_growth_pct`, `operating_income_growth_pct`,
  `free_cash_flow_growth_pct`, `forward_eps`
- **Quality / profitability:** `operating_margin_pct`, `free_cash_flow_margin_pct`
- **Size / raw levels (use as a tilt or inside a ratio — NOT a raw z-score; a $500 stock isn't
  "better" than a $50 one):** `market_cap`, `shares_outstanding`, `close`, `adj_close`, `high_52w`,
  `ma_200d`, `eps_ttm`, `revenue_ttm`, `operating_income_ttm`, `free_cash_flow_ttm`

**Metric-coverage rule (required).** When you design a script, **consider EVERY metric in this
menu** — do not default to the same 4–5 out of habit. A given strategy may deliberately use only a
few (that is fine and often better), but that must be a *conscious choice*: the metrics you don't
use are ones you decided to give **weight 0**, not ones you forgot exist. Do **not** assume a metric
is useless because it's uncommon — it very likely is weak, but the only way to know is to try it, so
**across runs actively rotate which metrics you draw on** and let the backtest prove or kill each one
(that is the whole point of the lessons log). If you drop a metric a prior lesson already tested and
found weak, say so; if a metric has never been tried, it's a prime explore candidate.

Two cautions when you do reach for the wider menu: (1) many metrics are **correlated** (all the
return/momentum/distance columns are one bet; `pe`/`forward_pe`/`peg` are one bet) — stacking them
double-counts rather than adds signal; (2) fundamentals are present for only ~30% of names at a given
month, so leaning on them tilts selection toward large caps (the runner skips `None` metrics). Prefer
**normalizing by the weights actually present** for a name if you use sparse metrics.

The same script files work in V1 and V2 — only the evaluation differs. See
`tools/unapproved/scoring_scripts/exp_001_regime_momentum_quality_value.py` for a worked example.

## Explore vs. exploit policy (how to spend each iteration)

The objective is a script that maximizes `relative_return`, but the fastest route to a *true*
maximum is NOT to refine the current leader every run — that hill-climbs one idea and stalls in a
local optimum (and floods the feed with near-identical re-keyed copies). Split effort
deterministically between **exploit** (take the leader to its best) and **explore** (try a
structurally different tactic).

**Target mix ≈ 2 exploit : 1 explore. Measure it from the feed, don't guess.** Every experiment
tags its `NOTES` first line with `mode=exploit|explore; family=<slug>`. Take the **12 most recently
created** experiments (fetch with `&sort=recent`) and count modes: if explore is **under
one-third**, this iteration is **explore**; otherwise **exploit**. This self-corrects.

**Force explore when the champion family has plateaued** (regardless of the ratio): if the last 3
exploit runs whose parent is in the current top family each returned `metric_delta <= +0.005`
relative (note: V2 deltas are ratio units, e.g. +0.005 = +0.5 percentage points of relative
return), the family is converged. Stop refining it; explore until a new family lands on the board.

### Exploit mode — take the leader to its best
- Parent = the top-`relativeReturn` script in the feed (same `benchmark_code` as you will run).
- Make **one** targeted, attributable change *within the same structural family*: retune a weight,
  shift a regime threshold, add or adjust a single factor. Keep `LOGIC_VARIANT_COUNT` honest.
- First `NOTES` line: `mode=exploit; family=<same family slug as the parent>`.

### Explore mode — try a genuinely different tactic
- The script must be **structurally unlike** every current top-family script — a different *idea*,
  not a re-tuned threshold. Rotate through archetypes the feed has NOT tried (or tried least):
  mean-reversion, deep value, low-volatility/quality-only, dividend/income, a different regime
  definition (gate on `median_from_200d_ma_pct` or breadth extremes), contrarian/other tilts
  (`from_52w_high_pct`, small-cap via `market_cap`), etc.
- Build a ledger from the feed of which `family` slugs already exist; pick an **untried** archetype.
- First `NOTES` line: `mode=explore; family=<new archetype slug>`.
- **An explorer that scores below the champion is a SUCCESS, not a waste.** Its value is the
  `--lesson`. Under V2 especially, judge an explore run by *which rolling windows / regimes* it
  beat the benchmark in (read `benchmark_win_rate_pct` and the `windows` array), not by
  `relative_return` alone. Only an explorer that beats or rivals the champion seeds a new family.

### Never submit a duplicate (mandatory, every iteration)
Re-submitting identical logic under a new `test_key` wastes the run and pollutes the leaderboard.
Before backtesting:
1. Fetch the minimized champion feed: `curl -s ".../experiments-feed-v2.min.php?pretty=1"`.
2. Compute a **logic fingerprint** of your candidate: drop the `FORMULA_NAME` and `NOTES` lines,
   strip comments and blank lines, normalize whitespace, then hash the remainder. Compare against the
   dedicated dedupe endpoint `.../experiment-fingerprints-v2.php` (it covers ALL historical scripts,
   not just family champions).
3. If your fingerprint matches any existing script, **do not mint a new `test_key`** — revise until
   structurally new. (Re-running an *existing* `test_key` to reproduce it is fine.)
4. Only if you need the winning script or its lessons, fetch that experiment's on-demand detail
   endpoint from its `detailUrl` field. Do not pull every champion script into the first pass.

## Progress logging (heartbeat — required)

Emit a log line at each meaningful step with `tools/approved/alog.py`, so the run is visible
remotely at `https://stock.369usa.com/logs.php` and the local watchdog can tell the automation is
still progressing (it flags a stall if no new log line appears for 5 min). One line per step is
plenty — at minimum: iteration start, after the backtest, after the publish, and on any error:
```
python3 tools/approved/alog.py "iter start: studying feed" --source autopilot
python3 tools/approved/alog.py "backtested exp_NNN: relative_return 1.27x (Δ +0.01 vs exp_MMM)" --source autopilot --test-key exp_NNN
python3 tools/approved/alog.py "published exp_NNN to prod" --source autopilot --test-key exp_NNN
python3 tools/approved/alog.py "FAILED exp_NNN: <what broke>" --level error --source autopilot --test-key exp_NNN
```
(Logging writes only to the LOCAL `automation_log` table; `deploy/push_logs.sh` mirrors the latest
500 to prod every minute. Never block an iteration on a logging failure.)

## Two ways to run this loop

- **Interactively** (you, or an agent, following the steps below) — flexible, good for hands-on steering.
- **Headless / unattended** — `tools/approved/run_autopilot.py` is a hard supervisor that performs
  the exact steps below deterministically (mode decision, dedupe, backtest, lesson, publish, `alog`
  heartbeat, retry/skip, resume) and delegates only the creative *script generation* to a pluggable
  generator (`--generator codex` = headless `codex exec`, hybrid; or `--generator mutate` = no-AI
  parameter sweep). Run `python3 tools/approved/run_autopilot.py --loop`; pair with `watchdog.sh`
  (`WORKER_CMD='python3 tools/approved/run_autopilot.py --loop'`) for multi-day self-healing.

## The loop (autonomous — no prompts)

1. **Study the production V2 feed FIRST (required).** Log `iter start` (see *Progress logging*),
   then fetch the live V2
   feed with full scripts and read it end to end — it is the system of record:
   ```
   curl -s "https://stock.369usa.com/experiments-feed-v2.min.php?pretty=1"
   ```
   It returns one champion per family ranked by `relativeReturn`, each with compact metrics and a
   `detailUrl` for on-demand script retrieval. It also returns a `recentExperiments` block for the
   last 12 runs (use that for the mode counts). Build from it: the **mode counts of the last 12
   experiments** and the **family ledger** (already champion-only). Fetch `detailUrl` only for the
   one or two parent candidates you actually choose to inspect, and use the separate
   `experiment-fingerprints-v2.php` endpoint only for dedupe.
2. **Decide this iteration's mode, then hypothesize** (see *Explore vs. exploit policy*). Exploit:
   parent = top-`relativeReturn` script; form ONE attributable change within its family, grounded in
   the lessons. Explore: pick an untried archetype and design a structurally new script; still pass
   `--parent-test-key` = the current champion so `metric_delta` is measured against the bar.
3. **Write the script.** Save `tools/unapproved/scoring_scripts/exp_NNN_<slug>.py` (increment N).
   Set `LOGIC_VARIANT_COUNT` to the true number of regime branches. Make the **first `NOTES` line**
   `mode=<exploit|explore>; family=<slug>`. Then run the **dedupe guard** (step above).
4. **Backtest + record locally** (one command does all windows, the benchmark, aggregation, upsert,
   picks, and lesson):
   ```
   python3 tools/approved/scoring_lab_v2.py \
     --script tools/unapproved/scoring_scripts/exp_NNN_<slug>.py \
     --test-key exp_NNN --upsert \
     --benchmark spy \
     --parent-test-key <parent> \
     --lesson "<what changed vs parent and how relative_return moved, in which windows/regimes, with the why>" \
     --lesson-direction improve|degrade|neutral \
     --out tools/unapproved/exp_NNN_v2_result.json
   ```
   `--benchmark spy` uses the shipped benchmark data at `tools/data/spy_benchmark.json` (the default
   `--benchmark-file`) — currently the cap-weight proxy (`benchmark_code = CAPW_UNIV`), automatically
   real SPY once that file is replaced. All experiments therefore share one benchmark source.
   The runner computes `metric_delta` (in relative-return units) vs the parent automatically. It runs
   in ~8s warm / ~15s cold (rank every month once, then ~180 windows as fast single-asset XIRRs; the
   benchmark is loaded from `tools/data`, not recomputed). **Always pass `--lesson`** — an explore run
   that lost to the champion still MUST record why and in which windows. Then log the result
   (`alog.py "backtested exp_NNN: ..." --source autopilot --test-key exp_NNN`).
5. **Publish to production (required).** From `stock_report_website/`:
   ```
   ./deploy/publish_scoring_results_v2.sh exp_NNN
   ```
   (The `publish-scoring-results-v2` skill; it mirrors the V2 experiment + picks + lesson to prod.)
   Then log it (`alog.py "published exp_NNN to prod" --source autopilot --test-key exp_NNN`).
6. **Record an app/data suggestion** only if you hit a genuine tooling/data limitation (e.g. real
   SPY benchmark data — see *Benchmark* below).
7. **Loop** to step 1. Stop only on the user's stop condition (or when told to stop).

## Benchmark

The benchmark is one file: **`tools/data/spy_benchmark.json`**. Run with `--benchmark spy` (already in
the step-4 command; it defaults `--benchmark-file` to that path) and the runner computes the
benchmark's XIRR for every rolling window itself, using the same deposits/dates as the strategy —
so the two always stay consistent. That's the whole comparison; nothing else to set up.

**Interim vs real SPY.** There is no SPY series in the project yet, so the file currently holds an
in-panel cap-weight proxy (`benchmark_code = CAPW_UNIV`). To switch to real SPY, regenerate that one
file — no workflow change:

```
python3 tools/approved/build_spy_benchmark.py --spy-file <dividend-adjusted SPY {me,adj_close}>
```

Rows then carry `benchmark_code = SPY`. **Only compare `relative_return` within the same
`benchmark_code`** — never rank SPY runs against the older `CAPW_UNIV` proxy runs. (If the lack of
real SPY data blocks progress, record it as a data suggestion.)

## Building blocks

- `tools/approved/build_metrics_panel.py` — one-time export of `stock_monthly_metrics` (+ symbol)
  to `tools/unapproved/metrics_panel.json`. Re-run only if the underlying metrics table changes.
- `tools/approved/scoring_lab_v2.py` — the V2 runner (rank-every-month precompute, strategy +
  benchmark NAV series, rolling + anchored windows, XIRR, aggregation to `relative_return`, DB
  writes to the V2 tables). It reuses V1's audited point-in-time engine (`tools/approved/scoring_lab.py`)
  for panel access, reporting lag, restricted-namespace exec, and XIRR, so the no-look-ahead
  discipline is identical. Anchored-window strategy gains reproduce V1 exactly (validated).
  Flags: `--benchmark capw|ew|spy`, `--benchmark-file`, `--rolling-years` (default 5),
  `--reporting-lag-days` (default 60), `--top-n` (default 15), `--upsert`,
  `--lesson`/`--lesson-direction`/`--parent-test-key`.
- Candidate scripts live in `tools/unapproved/scoring_scripts/`; the generated
  `tools/unapproved/metrics_panel.json` is a data artifact (both git-ignored).
- Reporting lag is a **flag, not a knob to weaken silently** — if a run lowers it, say so in the
  lesson; it changes the honesty of the fundamentals.

## Caveats worth a lesson if they bite

- **Interim benchmark.** `CAPW_UNIV`/`EW_UNIV` are proxies, not SPY. `relative_return` measures skill
  vs a passive same-universe market portfolio — a strong, survivorship-consistent baseline, but not
  literally the S&P 500. Re-baseline to `SPY` when data lands.
- **Residual survivorship.** The panel has ~950 names with real drop-outs but is not a complete
  point-in-time index. Absolute gains are optimistic; the benchmark-*relative* ranking is the
  trustworthy signal (both strategy and benchmark share the same universe, so survivorship largely
  cancels in the ratio).
- **Regime proxy.** There is no SPY/VIX; `regime` is derived from universe breadth and realized vol.
- **Overlapping windows.** Rolling 5-year windows at a monthly step overlap heavily, so the ~180
  per-window gains are NOT independent samples — read `benchmark_win_rate_pct` and the tails
  (`worst_window_ratio`) as robustness color, not as a statistical significance test.
