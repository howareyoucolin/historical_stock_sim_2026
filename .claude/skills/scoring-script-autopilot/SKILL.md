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
- **Every run is recorded.** `--upsert` writes three tables: the result to
  `report_scoring_experiments` (keyed on `test_key`; re-running a script updates its row), the
  month-by-month **top-15 picks** to `report_scoring_experiment_picks` (rank, symbol, score,
  weight — replaced per `test_key` each run, so you can study which stocks it selected), and a
  `report_scoring_lessons` row when `--lesson` is given.
- **Production is the system of record — learn from it, and always publish to it.** The local DB
  is only a scratch pad for running; results are kept on prod. After every run you MUST publish
  with the website `publish-scoring-results` skill (`./deploy/publish_scoring_results.sh <test_key>`),
  and you MUST start each iteration by reading the **production feed** (see step 1) — not the
  local DB — so you learn from the full accumulated history.

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

## Explore vs. exploit policy (how to spend each iteration)

The objective is a script that maximizes `justified_gain`, but the fastest route to a *true*
maximum is NOT to refine the current leader every run — that hill-climbs one idea and stalls in
a local optimum (and, unchecked, floods the feed with near-identical re-keyed copies). Split
effort deterministically between **exploit** (take the leader to its best) and **explore** (try a
structurally different tactic).

**Target mix ≈ 2 exploit : 1 explore. Measure it from the feed, don't guess.** Every experiment
tags its `NOTES` first line with `mode=exploit|explore; family=<slug>`. Take the **12 most recently
created** experiments — the feed sorts by score by default, so fetch this count with
`&sort=recent` (or sort by `createdAt` yourself) — and count modes: if explore is **under
one-third** of them, this iteration is **explore**; otherwise **exploit**. This self-corrects — a
burst of exploit runs pulls the next one toward explore, and vice-versa.

**Force explore when the champion family has plateaued** (regardless of the ratio): if the last 3
exploit runs whose parent is in the current top family each returned `metric_delta <= +0.05`
justified, the family is converged. Stop refining it; explore until a new family lands on the board,
then let exploit resume on whichever family now leads.

### Exploit mode — take the leader to its best
- Parent = the top-`justifiedGainPct` script in the feed.
- Make **one** targeted, attributable change *within the same structural family*: retune a weight,
  shift a regime threshold, add or adjust a single factor. Keep `LOGIC_VARIANT_COUNT` honest.
- First `NOTES` line: `mode=exploit; family=<same family slug as the parent>`.

### Explore mode — try a genuinely different tactic
- The script must be **structurally unlike** every current top-family script — a different *idea*,
  not a re-tuned threshold. Rotate through archetypes the feed has NOT tried (or tried least):
  - **mean-reversion** — buy oversold: low `return_1m/3m_pct`, well below `ma_200d`
  - **deep value** — low `pe`/`peg`, high `free_cash_flow_margin_pct`, no momentum gate
  - **low-volatility / quality-only** — rank by low `realized_vol_3m` + high margins
  - **dividend / income** — high `dividend_yield_ttm_pct` + rising `dividend_ttm`
  - **different regime definition** — gate on `median_from_200d_ma_pct` or breadth extremes
    instead of the current bull/risk-off split
  - **contrarian / other tilts** — `from_52w_high_pct`, small-cap via `market_cap`, etc.
- Build a ledger from the feed of which `family` slugs already exist; pick an **untried** archetype,
  or the least-tried. Never repeat an archetype that already has a script.
- First `NOTES` line: `mode=explore; family=<new archetype slug>`.
- **An explorer that scores below the champion is a SUCCESS, not a waste.** Its value is the
  `--lesson`: always record *why* the tactic under/over-performed and in which window. Only an
  explorer that beats or rivals the champion seeds a new family for exploit to refine — a losing one
  still leaves a durable lesson so the loop never blindly re-tries that dead end. Do NOT let the
  raw `justified_gain` alone judge an explore run; judge it by what it taught.

### Never submit a duplicate (mandatory, every iteration)
Re-submitting identical logic under a new `test_key` wastes the run and pollutes the leaderboard —
this has already happened at scale. Before backtesting:
1. Fetch all scripts: `curl -s ".../experiments-feed.php?pretty=1&view=full&limit=500"`.
2. Compute a **logic fingerprint** of your candidate: drop the `FORMULA_NAME` and `NOTES` lines,
   strip comments and blank lines, normalize whitespace, then hash the remainder. Fingerprint every
   feed script the same way.
3. If your fingerprint matches any existing script, **do not mint a new `test_key` for it** — revise
   until it is structurally new. (Re-running an *existing* `test_key` to reproduce it is fine;
   creating a new key for identical logic is the bug.)

## The loop (autonomous — no prompts)

1. **Study the production feed FIRST (required).** Before proposing anything, fetch the live
   experiments feed with full scripts and read it end to end — it is the system of record (results
   are published to prod, not kept locally):
   ```
   curl -s "https://stock.369usa.com/experiments-feed.php?pretty=1&view=full&limit=500"
   ```
   It returns every experiment ranked by `justifiedGainPct`, each with its `lessons` (what changed
   the score and why), `favoredStocks` (which names the formula gravitated to), and the full scoring
   script, plus a global `lessons` list. For one experiment's month-by-month picks:
   `...experiments-feed.php?testKey=<key>&picks=full`. Ground your next move in what the feed shows;
   do NOT read the local DB for this — it may be behind prod. While reading, build three things you
   will need below: the **mode counts of the last 12 experiments** (from each `NOTES` line), the
   **family ledger** (which `family` slugs exist and their best `justifiedGainPct`), and the **logic
   fingerprints** of all existing scripts (for the dedupe guard).
2. **Decide this iteration's mode, then hypothesize** (see *Explore vs. exploit policy* above):
   - Apply the 2:1 rule and the plateau override to choose **exploit** or **explore**.
   - **Exploit:** parent = top-`justifiedGainPct` script; form ONE concrete, attributable change
     within its family, grounded in the lessons (e.g. "raise the risk-off low-vol weight; the last
     two degrade-lessons say momentum hurt the 2006 window"). One change at a time.
   - **Explore:** pick an untried (or least-tried) archetype from the family ledger and design a
     structurally new script for it. There is no "parent" in the family sense; still pass
     `--parent-test-key` = the current champion so `metric_delta` is measured against the bar.
3. **Write the script.** Save a new file `tools/unapproved/scoring_scripts/exp_NNN_<slug>.py`
   (increment N). Set `LOGIC_VARIANT_COUNT` to the true number of regime branches. Make the **first
   `NOTES` line** `mode=<exploit|explore>; family=<slug>` so the feed stays measurable. Then run the
   **dedupe guard**: fingerprint this script and compare to every feed script — if it matches an
   existing one, revise until structurally new before proceeding (never mint a new key for existing
   logic).
4. **Backtest + record locally** (one command does the 4 windows, aggregation, upsert, and lesson):
   ```
   python3 tools/approved/scoring_lab.py \
     --script tools/unapproved/scoring_scripts/exp_NNN_<slug>.py \
     --test-key exp_NNN --upsert \
     --parent-test-key <parent> \
     --lesson "<what changed vs parent and how justified_gain moved, with the why>" \
     --lesson-direction improve|degrade|neutral \
     --out tools/unapproved/exp_NNN_result.json
   ```
   The runner computes `metric_delta` vs the parent automatically. **Always pass `--lesson`** — an
   explore run that lost to the champion still MUST record why its tactic under-performed and in
   which window (that is its entire payoff). `--lesson-direction` reflects `metric_delta` vs the
   champion; a `degrade` on an explore run is expected and still valuable.
5. **Publish to production (required).** From `stock_report_website/`, push the run so the feed
   (and the next iteration) sees it — otherwise your learning history stalls:
   ```
   ./deploy/publish_scoring_results.sh exp_NNN
   ```
   (This is the `publish-scoring-results` skill; it mirrors the experiment + picks + lesson to prod.)
6. **Record the app/data suggestion** only if you hit a genuine tooling/data limitation.
7. **Loop** to step 1. Stop only on the user's stop condition (or when told to stop).

## Building blocks

- `tools/approved/build_metrics_panel.py` — one-time export of `stock_monthly_metrics`
  (+ symbol) to `tools/unapproved/metrics_panel.json`, capped at the data boundary via approved
  `db.py`. Re-run only if the underlying metrics table changes.
- `tools/approved/scoring_lab.py` — the four-window runner (ranking, regime, reporting
  lag, restricted-namespace script exec, in-process monthly-rebalance backtest, XIRR,
  aggregation, DB writes). Runs the full four windows in ~15–20s.
  Flags: `--reporting-lag-days` (default 60), `--top-n` (default 15), `--upsert`,
  `--lesson`/`--lesson-direction`/`--parent-test-key`.
- Candidate scripts live in `tools/unapproved/scoring_scripts/` and the generated
  `tools/unapproved/metrics_panel.json` is a data artifact (both git-ignored).
- Reporting lag is a **flag, not a knob to weaken silently** — if a run lowers it, say so in
  the lesson; it changes the honesty of the fundamentals.

## Caveats worth a lesson if they bite

- **Residual survivorship.** The panel has ~950 names with real drop-outs (delisted stocks age
  out via the freshness filter), so it is *not* pure survivorship — but it is not a complete
  point-in-time index either. Treat absolute gains as optimistic; the cross-script *ranking* by
  justified_gain is the trustworthy signal.
- **Regime proxy.** There is no SPY/VIX; `regime` is derived from universe breadth and realized
  vol. It is a proxy, not the real market.
