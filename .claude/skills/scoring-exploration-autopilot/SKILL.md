---
name: scoring-exploration-autopilot
description: Autonomously search for stock scoring equations using the monthly metrics table and fixed multi-window backtests. Use when the user wants a self-driving factor lab, scoring-formula exploration, justified_gain optimization, or a unified stock-ranking script that is tested across the anchored windows starting on July 3, 2006; July 1, 2011; July 1, 2016; and July 1, 2021.
---

# Scoring Exploration Autopilot

Run an unattended search for the best **monthly stock-scoring formula**. The goal is
to discover a **single unified equation** that ranks stocks well across four anchored
historical windows, with as little window-specific branching as possible.

This skill is for **formula discovery**, not discretionary trading. Treat each
candidate as a research artifact that should be reproducible, comparable, and
persisted after evaluation into the website DB table `report_scoring_experiments`.

## Hard rules

- **Fixed evaluation windows only.** Unless the user explicitly changes them, test every
  candidate on exactly these four windows:
  - `2006-07-03` to `2011-06-30`
  - `2011-07-01` to `2016-06-30`
  - `2016-07-01` to `2021-06-30`
  - `2021-07-01` to `2026-06-26`
- **Unified formula first.** Default to `logic_variant_count = 1`. Do not create
  market-regime, theme, or date-branch variants unless a unified formula has clearly
  stalled and the user still wants more exploration.
- **All monthly metrics are eligible inputs.** Use `stock_monthly_metrics` as the
  canonical feature set. Every available metric should be considered part of the search
  space, but the final winning formula does not need to assign a non-zero weight to
  every metric.
- **No look-ahead.** Any dated database read must go through `tools/approved/db.py`
  (`fetch`) or another approved wrapper that caps data at the simulation date. If you
  build a helper for monthly-factor research, it must preserve point-in-time month-end
  semantics.
- **Prefer reusable tools.** Check `tools/docs/TOOLS.md` first. Start from approved
  tools such as `factor_rank`, `aggregate_sweep`, and the existing autopilot scripts.
  If they do not expose the needed monthly metrics, build a reusable helper under
  `tools/unapproved/` rather than a one-off script.

## What to optimize

For each candidate formula, capture four window results:

- `gain_2006_window_pct`
- `gain_2011_window_pct`
- `gain_2016_window_pct`
- `gain_2021_window_pct`

Use **annualized gain percent** for each window unless the user has explicitly defined a
different gain metric.

Then compute:

- `weighted_gain_pct = 0.16 * g2006 + 0.24 * g2011 + 0.28 * g2016 + 0.32 * g2021`
- `window_dispersion_pct = stddev([g2006, g2011, g2016, g2021])`
- `logic_variant_count = number of distinct formula branches`

Default objective:

- `justified_gain = weighted_gain_pct - window_dispersion_pct`

Complexity handling:

- Do **not** hide extra branch complexity inside the formula silently.
- If two candidates are close, prefer the lower `logic_variant_count`.
- If a branchy candidate only wins by a tiny amount, keep the simpler unified one as
  the leader.

## Search strategy

Work in waves instead of random thrashing:

1. **Baseline wave**
   - Start with simple unified formulas: weighted sums, ranked sums, or z-scored
     composites.
   - Cover the major metric families: momentum, reversal, valuation, growth, quality,
     volatility, liquidity, dividends, and size/cap.
2. **Expansion wave**
   - Add transforms: winsorization, percentile rank, z-score, sign flip, min/max caps,
     and simple gating rules.
   - Test interaction logic only when it remains unified, for example
     "momentum weight scales down when volatility is high."
3. **Refinement wave**
   - Only refine candidates that are already strong on `weighted_gain_pct` and not
     collapsing on one of the four windows.
   - Tune one axis at a time so the improvement is attributable.
4. **Last-resort branching wave**
   - Introduce multiple variants only if unified formulas consistently fail and the user
     still wants exploration.
   - Record the exact trigger for every branch and increment `logic_variant_count`.

## Candidate design guidelines

- Start from a **machine-readable scoring spec** whenever possible, not just opaque free
  text. A good candidate has:
  - a short id or slug
  - a human-readable summary
  - the exact formula or script
  - the metric list it references
  - any transforms, caps, and gates
- Prefer formulas the simulator can rerun mechanically and monthly.
- Avoid fragile micro-tuning. A formula that only works at one exact threshold is
  probably overfit.
- When a metric has sparse historical coverage, either:
  - use a clean fallback that preserves a unified formula, or
  - gate the metric out without creating a separate strategy family.

## Execution flow

For each iteration:

1. Review prior candidates and identify the current leader by `justified_gain`, then by
   lower `window_dispersion_pct`, then by lower `logic_variant_count`.
2. Generate the next candidate from the current wave.
3. Run all four anchored windows.
4. Save the exact formula/script and the four window gains.
5. Compute `weighted_gain_pct`, `window_dispersion_pct`, and `justified_gain`.
6. Persist the result to `report_scoring_experiments` immediately after evaluation.
7. Keep a leaderboard and note what changed versus the previous best.
8. Continue until the user stops the run or the search clearly plateaus.

## Tooling guidance

- **If the approved `factor_rank` tool is enough**, use it as the first engine for
  unified linear factor composites.
- **If you need the full `stock_monthly_metrics` feature set**, create a reusable
  helper in `tools/unapproved/` that:
  - loads month-end rows through `approved/db.py`
  - ranks the universe point-in-time by a candidate formula
  - simulates monthly rebalances over the four anchored windows
  - writes a leaderboard artifact the agent can iterate on
- If a helper proves broadly useful and stable, leave it in `tools/unapproved/` for
  admin review and possible promotion later.

## Persistence requirement

After each candidate finishes, write one row to `report_scoring_experiments`.

Preferred path:

1. Build a JSON payload with:
   - `test_key`
   - `formula_name`
   - `scoring_definition`
   - `definition_format`
   - `window_2006_2011_gain_pct`
   - `window_2011_2016_gain_pct`
   - `window_2016_2021_gain_pct`
   - `window_2021_2026_gain_pct`
   - `weighted_gain_pct`
   - `window_dispersion_pct`
   - `justified_gain_pct`
   - `logic_variant_count`
   - `notes`
2. Pipe it to:

```bash
docker exec -i stock_report_php php /var/www/html/data/importers/report_scoring_experiment_upsert.php
```

The script reads JSON from STDIN and upserts by `test_key`, so reruns of the same
candidate should update the existing row instead of creating duplicates.

## Deliverables

When the run pauses or finishes, provide:

- the current best unified scoring formula
- the top leaderboard entries with all four window gains
- the current `justified_gain`, `weighted_gain_pct`, `window_dispersion_pct`, and
  `logic_variant_count`
- a short note on which metric families consistently helped and which ones appeared
  unstable or overfit
