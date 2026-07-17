---
name: scoring-script-autopilot
description: Autonomously invent and test regime-aware stock-scoring SCRIPTS (Python, with branching logic like "if bull market, weight momentum more") across the four anchored windows, ranking the full universe monthly and holding the top 15 at rank weights. Studies prior results + accumulated lessons, proposes an improved script, backtests it, records the result and what it learned, and loops. Use when the user wants a self-driving scoring-script lab, "find a better scoring rule", justified_gain optimization, or continuous scoring exploration. Optimizes justified_gain. Supersedes the retired scoring-exploration-autopilot (which was formula-only and forbade regime branching).
---

# Scoring Script Autopilot

Run an unattended search for the best **monthly stock-scoring SCRIPT**. Unlike a fixed
formula, a script may branch on the market regime (e.g. *if bull: weight momentum more;
if risk-off: favor low-vol quality/value*). Each iteration the agent studies what has
been tried and learned, writes a **new or improved Python script**, backtests it across
the four anchored windows, and records both the numbers and a **lesson** about what moved
the objective. The goal is a script that ranks stocks well across all four windows, with
recent windows weighted most.

This is **research**, not discretionary trading. Every candidate is reproducible: the exact
script text is stored in the DB, so any row can be re-run and re-scored.

## Hard rules

- **No look-ahead, no hindsight — this is the top priority.** Enforced structurally, not by
  intention:
  - Signals come only from `tools/unapproved/metrics_panel.json`, sliced `month_end <= checkpoint`.
  - Quarter-derived fundamentals (incl. `forward_eps`/`forward_pe`/`peg`) are exposed only
    after a **reporting lag** (default 60 days) past `fiscal_quarter`, because the importer
    attaches a quarter on its END date with no filing lag (a real leak the runner corrects).
  - The scoring script runs in a **restricted namespace** (no imports / files / network): it
    can only ever read the point-in-time features handed to it.
  - The backtest is in-process over the panel's month-end series (valued on `adj_close`,
    dividends reinvested); ranking at month_end d uses d's own metrics and trades at d's close.
  - Scripts must be **mechanical**: a stock's score is a function of observable metrics, never
    of a ticker's known future (no "AAPL did great" — the same function scores all ~950 names).
- **Fixed evaluation harness (do not change without the user's say-so).** Every script is
  scored on exactly these, so results stay comparable:
  - Windows: `2006-07-03..2011-06-30`, `2011-07-01..2016-06-30`, `2016-07-01..2021-06-30`,
    `2021-07-01..2026-06-26` — annualized gain per window.
  - Sizing: rank the full universe, **hold the top 15**, **linear-decay** rank weights
    (rank 1 ≈ 12.5% … rank 15 ≈ 0.8%), **0 past rank 15**, full monthly rebalance to those
    weights (fractional shares, no fees).
  - Funding: `$200,000` initial + `$2,500` each month.
  - Gain metric: per-window money-weighted annualized return (XIRR on the deposit cash flows +
    ending value — the same metric `report build` uses).
  - Objective: `weighted_gain = .16·g06 + .24·g11 + .28·g16 + .32·g21`,
    `dispersion = stddev(the four gains)`, **`justified_gain = weighted_gain − dispersion`**
    (the leaderboard metric — rewards a script that works in ALL regimes).
- **The SCRIPT is the only variable.** Sizing/windows/funding/objective are harness policy.
  Change them only if the user explicitly asks; otherwise a run tells you whether the *ranking
  logic* worked, nothing else.
- **Every run is recorded.** Upsert the result to `report_scoring_experiments` (keyed on
  `test_key`; re-running a script updates its row) and append a `report_scoring_lessons` row.

## The scoring-script contract

Each script is a file under `tools/unapproved/scoring_scripts/` defining:

```python
FORMULA_NAME = "..."          # human label (optional; defaults to filename)
LOGIC_VARIANT_COUNT = 2       # number of distinct regime branches (=> DB column)
NOTES = "..."                 # short description (optional)

def score_universe(stocks, regime, ctx):
    # stocks : list[dict] — one point-in-time row per eligible stock (see fields below)
    # regime : {'bull', 'breadth', 'avg_realized_vol_3m', 'median_momentum_12_1_pct',
    #           'median_from_200d_ma_pct', 'universe_size'}
    # ctx    : ctx.z(metric) -> {symbol: cross-sectional z or None}; ctx.regime; ctx.date
    # return : {symbol: score}  (higher = better; the runner holds the top 15)
    ...
```

Row fields available (point-in-time; fundamentals reporting-lagged):
`close, adj_close, return_1m/3m/6m/12m_pct, momentum_12_1_pct, high_52w, from_52w_high_pct,
ma_200d, from_200d_ma_pct, realized_vol_3m, avg_daily_volume_3m, avg_daily_dollar_volume_3m,
trading_days_3m, dividend_ttm, dividend_yield_ttm_pct, eps_ttm, eps_growth_pct, forward_eps,
pe, forward_pe, peg, revenue_ttm, revenue_growth_pct, operating_income_ttm,
operating_income_growth_pct, free_cash_flow_ttm, free_cash_flow_growth_pct,
operating_margin_pct, free_cash_flow_margin_pct, shares_outstanding, market_cap`.

See `tools/unapproved/scoring_scripts/exp_001_regime_momentum_quality_value.py` for a
worked two-regime example.

## The loop (autonomous — no prompts)

1. **Study.** Read the current standings and memory:
   - Leaderboard: `SELECT test_key, formula_name, weighted_gain_pct, window_dispersion_pct,
     justified_gain_pct, logic_variant_count FROM report_scoring_experiments
     ORDER BY justified_gain_pct DESC LIMIT 20;`
   - Lessons: `SELECT direction, metric_delta, lesson, regime_context FROM report_scoring_lessons
     ORDER BY id DESC LIMIT 30;`
   (Query via `docker exec -i stock_report_mysql mysql -ustock_user -pstock_pass stock_report ...`.)
2. **Hypothesize.** Pick the best current script as the **parent** and form ONE concrete,
   testable change grounded in the lessons (e.g. "raise the risk-off low-vol weight; the last
   two degrade-lessons say momentum hurt the 2006 window"). Prefer one change at a time so the
   lesson is attributable.
3. **Write the script.** Save a new file `exp_NNN_<slug>.py` (increment N). Set
   `LOGIC_VARIANT_COUNT` to the true number of regime branches.
4. **Backtest + record** (one command does the 4 windows, aggregation, upsert, and lesson):
   ```
   python3 tools/unapproved/scoring_lab.py \
     --script tools/unapproved/scoring_scripts/exp_NNN_<slug>.py \
     --test-key exp_NNN --upsert \
     --parent-test-key <parent> \
     --lesson "<what changed vs parent and how justified_gain moved, with the why>" \
     --lesson-direction improve|degrade|neutral \
     --out tools/unapproved/exp_NNN_result.json
   ```
   The runner computes `metric_delta` vs the parent automatically.
5. **Record the app/data suggestion** only if you hit a genuine tooling/data limitation.
6. **Loop** to step 1. Stop only on the user's stop condition (or when told to stop).

## Building blocks

- `tools/unapproved/build_metrics_panel.py` — one-time export of `stock_monthly_metrics`
  (+ symbol) to `metrics_panel.json`, capped at the data boundary via approved `db.py`.
  Re-run only if the underlying metrics table changes.
- `tools/unapproved/scoring_lab.py` — the four-window runner (ranking, regime, reporting
  lag, restricted-namespace script exec, in-process monthly-rebalance backtest, XIRR,
  aggregation, DB writes). Runs the full four windows in ~15–20s.
  Flags: `--reporting-lag-days` (default 60), `--top-n` (default 15), `--upsert`,
  `--lesson`/`--lesson-direction`/`--parent-test-key`.
- Reporting lag is a **flag, not a knob to weaken silently** — if a run lowers it, say so in
  the lesson; it changes the honesty of the fundamentals.

## Caveats worth a lesson if they bite

- **Residual survivorship.** The panel has ~950 names with real drop-outs (delisted stocks age
  out via the freshness filter), so it is *not* pure survivorship — but it is not a complete
  point-in-time index either. Treat absolute gains as optimistic; the cross-script *ranking* by
  justified_gain is the trustworthy signal.
- **Regime proxy.** There is no SPY/VIX; `regime` is derived from universe breadth and realized
  vol. It is a proxy, not the real market.
