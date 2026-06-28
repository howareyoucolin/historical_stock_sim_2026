---
name: stock-strategy-autopilot
description: Run stock-trade simulations on autopilot — fully autonomous, no prompts. It loops on its own, deriving improved mechanical strategy variants from the strategies already published on the production site and uploading every report back, to continuously grow the research archive. Use when the user wants a self-driving batch of simulations ("auto-simulate", "keep running simulations", "explore strategies on autopilot", "run the autopilot", "find me a good strategy"). Builds on stock-trade-simulation (per run) and simulation-reporting (per report); uploads each report automatically.
---

# Stock Strategy Autopilot

Drive an open-ended, **fully autonomous** series of stock-trade simulations — it never
prompts the user. Each iteration it picks its own run window and an improved strategy
variant, runs it end to end, builds the report, uploads it to the production site,
leaves an app/market-data suggestion, records the result, and loops. The goal is to
continuously add research results to the prod archive at https://stock.369usa.com.

This skill is the orchestration layer; each run still follows
`.claude/skills/stock-trade-simulation/SKILL.md` and reports follow
`.claude/skills/simulation-reporting/SKILL.md` — **except the autopilot does NOT ask
the four setup questions**; it sets them itself (§1) and never pauses for input.

## Hard rules (inherited from stock-trade-simulation)

Every per-run guardrail from `stock-trade-simulation` applies in full:

- **CLI only for trading decisions.** Within a run, never read source, query the
  market-data API/database directly, or open `user-sessions/` files — interact only
  through `npm run cli -- ...` (its data is already bounded to the simulated date).
  (Orchestration may read the public report archive at stock.369usa.com and read
  `.env` for the upload key — those are not trading-data reads.)
- **No hindsight.** Every variant is a mechanical rule decided from data observable as
  of the sim date. Never pick/avoid a ticker by how it really performed (including no
  "reverse hindsight" for deliberately bad controls — make those bad *by rule*).
- **One run at a time on the default session** — strictly sequential, never concurrent.
  Each run starts with `account init` (a clean slate).
- **Mechanical variants only**, so each run can be script-driven.

## 1. Per-run configuration (autonomous — no prompts)

The autopilot sets every parameter itself; it never asks the user. For each run:

- **Time range:** randomly pick **5 or 10 years**.
- **Start date:** pick a random date in `[2001-01-02, 2026-06-26 − range]` so the full
  range fits and the run ends on or before the data boundary `2026-06-26`
  (`end = start + range`). If the start lands on a non-trading day, the run begins on
  the next one. (This guarantees a complete 5y/10y backtest — never a truncated window.)
- **Funding:** initial `$200,000` + `$2,500` on the first trading day of each month.
- **Strategy:** an *improved* variant derived from the published research (§3) — unless
  the user explicitly named specific strategies to test, in which case run those.
- **Upload:** always, automatically (§4) — no permission prompt.

Vary randomness by run index/time so successive runs differ; never reuse a
`(range, start, strategy)` combination already in the ledger.

## 2. Keep a sweep ledger

Maintain a running ledger of variants tried so the search adapts and never repeats
itself. Track per variant: id/params, the **run window (start + range)**, ending value,
total & annualized return, **edge over the built-in benchmark**, max drawdown,
after-tax result, and turnover. Store it as a local working file (scratchpad or a
gitignored file) — your memory across iterations, not a deliverable.

**Judge on relative, risk-adjusted performance, not the raw multiple.** The universe is
survivorship-biased, so absolute returns are inflated and only comparisons are
trustworthy. Rank by edge over the benchmark and drawdown/turnover-adjusted return.

> **Benchmark.** `report build` emits a built-in **equal-weight S&P 500 index**
> benchmark in `report.json` (`benchmark` block, `stockCode: "S&P 500 (EW)"`) on the
> same DEPOSIT schedule. Read its figures straight from each report; don't recompute.

## 3. Learn from published research, then improve

Before designing a variant, **read the strategies already published on the production
site**: fetch the archive at https://stock.369usa.com (the index lists past reports;
open report pages to read each strategy's rules, run window, and result vs the
benchmark). Use that to (a) avoid repeating a strategy/window already published, and
(b) design an **improved** variant — adjust the rule or parameter that looks like it
held a prior strategy back.

Unless the user explicitly asks to test specific strategies, the autopilot's job is to
iteratively improve on what is already published.

Draw improvements from these mechanical families and axes:

- **Families:** relative-strength momentum rotation; dual-momentum (momentum + cash
  guard); market-cap-weight top-N; equal-weight top-N; low-volatility/low-beta tilt;
  value tilt (low P/E); dividend tilt; sector- or segment-bucket allocations; quality
  screens; and clearly-labeled negative controls (anti-momentum, high-P/E chase, etc.).
- **Parameter axes** (vary one at a time around a base): momentum lookback (3/6/12 mo),
  holding count `top_k`, rebalance cadence (monthly/quarterly/annual), hysteresis buffer
  width, weighting (equal vs cap), universe market-cap floor, cash/absolute-momentum
  guard threshold, and trim-winners vs let-run (tax turnover).
- **Search method:** start from a strong published baseline; make controlled one-axis
  changes so each result is attributable; hill-climb on the risk-adjusted edge; and
  periodically inject a fresh family to escape a local optimum. Record each variant's
  rule in the report's strategy metadata.

## 4. The autopilot loop (per iteration)

Run strictly sequentially. For each iteration:

1. **Set run params (§1):** random range, random fitting start, improved strategy (§3).
2. **Run it** end to end per `stock-trade-simulation`: `account init`,
   `date set <start>`, fund, drive the clock with irregular 1–10 day `date next` hops,
   make the monthly contribution, attach a data-grounded `--note` to every trade, and
   stop at the derived end date. Script the run for mechanical variants.
3. **Build the report** with `report build` per `simulation-reporting`, setting the
   strategy/objective metadata and the run window.
4. **Upload automatically — no prompt.** Read `SECRET_KEY` from `simulator/.env` and
   POST the five session files to `https://stock.369usa.com/insert.php?key=$SECRET_KEY`
   using the multipart shape from `upload-stock-report`. On `ok:true`, the next
   iteration's `account init` serves as the reset (no separate reset needed). If the
   upload fails, log the exact response and continue — do **not** reset, so it can be
   retried.
5. **Record** the result in the ledger (§2).
6. **Leave a suggestion** in `suggestions/` (§5).
7. **Loop.** Surface a one-line progress update (window, strategy, edge over benchmark,
   best so far) and continue to the next iteration. Keep looping until the user
   interrupts or says stop.

## 5. Leave a suggestion after every run

After each simulation, write exactly one suggestion file to `suggestions/` (git-ignored).
It is **only** about improving the **app/system or market data** — never a
trading-strategy idea. Follow the convention in `stock-trade-simulation`
(§"Leave an improvement suggestion"):

- **Path:** `suggestions/<YYYY-MM-DD>-<short-slug>.md` (real date; append `-2`, `-3`, … if taken).
- **Content:** category (`app-system` | `market-data`), the source run (strategy +
  session id + report id), the concrete observation, the proposed improvement, and a
  rough priority. Ground it in something the run actually hit. If nothing new surfaced,
  write a one-line note saying so.

## 6. Termination and summary

When the user stops it (or an external limit is hit):

- **Finish the in-flight run cleanly** (build + report + upload + suggestion); never
  abandon a half-done simulation.
- **Produce a leaderboard** of every variant tried, ranked by edge over the benchmark
  and risk-adjusted return, with the run window and the parameter that drove each
  result. Call out the best variant and the clearest dead ends.
- **Point to `suggestions/`** for the accumulated app/market-data notes.

## Guardrails

- **Fully autonomous: never prompt the user** — no setup questions, no upload permission.
- Per run: random **5 or 10-year** range + random start so the **full window fits ≤
  `2026-06-26`** (`end = start + range`).
- Improve on the strategies already published at stock.369usa.com unless the user named
  specific strategies to test.
- **Always upload** each report using `SECRET_KEY` from `simulator/.env`; never ask for
  the key. Upload target is production only (`https://stock.369usa.com`).
- One simulation at a time; mechanical and no-hindsight; judge on risk-adjusted edge.
- Each run leaves exactly one `suggestions/` note (app/market-data only).
- Build the report only at the run's true end date.
