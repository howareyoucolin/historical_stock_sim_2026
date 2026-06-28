---
name: stock-strategy-autopilot
description: Run stock-trade simulations on autopilot — automatically generate, run, and adjust mechanical strategy variants in a continuous loop until a stop condition is met or the user says stop. Use when the user wants an open-ended, self-driving batch of simulations rather than one named run ("auto-simulate", "keep running simulations", "explore strategies on autopilot", "sweep strategies", "try as many strategies as you can", "find me a good strategy"). Builds on stock-trade-simulation (per run), simulation-reporting (per report), and upload-stock-report (optional), and leaves an app/market-data suggestion after every run.
---

# Stock Strategy Autopilot

Drive an open-ended series of stock-trade simulations hands-free: pick a strategy
variant, run it to the end date, report it, leave an app/market-data suggestion,
record the result, then adjust into the next variant — and keep going until a stop
condition fires or the user says stop. This skill is the **orchestration layer**;
every individual run still follows `.claude/skills/stock-trade-simulation/SKILL.md`
exactly, and reports follow `.claude/skills/simulation-reporting/SKILL.md`.

## Hard rules (inherited from stock-trade-simulation)

Every per-run guardrail from `stock-trade-simulation` applies in full and is
non-negotiable here:

- **CLI only.** Never read source, query the market-data API/database directly, or
  open `user-sessions/` files; interact only through `npm run cli -- ...` (its data
  is already bounded to the simulated date).
- **No hindsight.** Every variant is a mechanical rule decided from data observable
  as of the sim date (trailing returns, P/E, market cap, dividends). Never pick or
  avoid a ticker because of how it really performed. This includes "reverse
  hindsight": do not engineer a deliberately bad control by naming tickers you know
  cratered — make a control bad *by rule*, not by name.
- **One run at a time on the default session.** All runs share the default session,
  so they MUST be strictly sequential — never launch two simulations concurrently.
  Each run starts with `account init` (a clean slate) per the simulation skill.
- **Mechanical variants only.** Favor fully rule-based strategies so the loop can be
  script-driven (see the simulation skill's "Scripted execution" section). A
  discretionary idea is out of scope for the autopilot.

## 1. Confirm the run contract before starting

Before the first run, pin down two things with the user (use sensible defaults and
proceed if they delegate):

1. **Stop condition** — how the autopilot ends. Default to "run until I say stop,"
   but surface progress after each run so the user can interject:
   - **Manual** — keep going until the user says stop (default).
   - **Count** — stop after N simulations.
   - **Time / deadline** — stop at a wall-clock time. Implement as a between-runs
     check: the in-flight run always finishes; no new run starts past the deadline.
   - **Target metric** — stop once a variant clears a bar (e.g. beats the built-in
     benchmark by X, annualized > Y, or max drawdown < Z at a given return).
   - **Convergence** — stop after K consecutive variants fail to improve the best
     risk-adjusted result.
2. **Per-run setup + publishing** — confirm the run config (defaults: start
   `2001-01-02`, `$200,000` + `$2,500`/mo, end `2026-06-26`) and whether to
   **upload each report** via `upload-stock-report` (production only, requires the
   secret key — ask once and reuse for the session only if the user clearly
   authorizes unattended uploads).

## 2. Keep a sweep ledger

Maintain a running ledger of variants tried so the search adapts and never repeats
itself. Track per variant: the variant id/params, ending value, total &
annualized return, **edge over the built-in benchmark**, max drawdown, after-tax
result, and turnover (buy/sell counts). Store it as a local working file (e.g. in
the scratchpad, or a gitignored file alongside `user-sessions/`) — it is your memory
across iterations, not a deliverable.

**Judge on relative, risk-adjusted performance, not the raw multiple.** The data
universe is survivorship-biased (it over-represents names that became winners), so
absolute returns are inflated and only comparisons are trustworthy. Rank variants by
their edge over the benchmark and by drawdown/turnover-adjusted return.

> **Benchmark.** `report build` emits a built-in **equal-weight S&P 500 index**
> benchmark in `report.json` (`benchmark` block, `stockCode: "S&P 500 (EW)"`),
> invested on the same DEPOSIT cashflow schedule. Read the benchmark's ending value
> and annualized return straight from each report — do not recompute it with a
> separate run.

## 3. Generate and adjust variants

Draw from a library of mechanical families and a set of parameter axes; explore
broadly, then hill-climb on what works.

**Families** (each fully rule-based): relative-strength momentum rotation;
dual-momentum (momentum + cash guard); market-cap-weight top-N; equal-weight top-N;
low-volatility / low-beta tilt; value tilt (low P/E); dividend tilt; sector- or
segment-bucket allocations; quality (earnings/PE) screens; and deliberate
negative-control anti-patterns for study (e.g. anti-momentum, high-P/E chase,
single-name concentration) — clearly labeled as controls.

**Parameter axes** to vary one at a time around a base: momentum lookback
(e.g. 3/6/12 mo), holding count `top_k`, rebalance cadence
(monthly/quarterly/annual), hysteresis buffer width, weighting (equal vs cap),
universe market-cap floor, the cash/absolute-momentum guard threshold, and whether
winners are trimmed vs let-run (tax turnover).

**Search method (explore / exploit):**
- Start from a reasonable base variant; run it.
- Make **controlled one-axis** changes off the current best (one parameter at a
  time) so each result is attributable.
- **Hill-climb:** keep changes that improve the risk-adjusted edge; discard the rest.
- Periodically **inject a fresh family** to escape a local optimum (exploration).
- Keep every variant traceable to observed data, and record its rule in the report's
  strategy metadata.

## 4. The autopilot loop (per iteration)

Run strictly sequentially. For each iteration:

1. **Pick the next variant** from §3 (skip anything already in the ledger).
2. **Run it** end to end per `stock-trade-simulation`: `account init`, fund, drive
   the clock with irregular 1–10 day `date next` hops, make the monthly
   contribution, attach a data-grounded `--note` to every trade, and stop at the end
   date. Script the run for mechanical variants.
3. **Build the report** with `report build` per `simulation-reporting`, setting the
   strategy name/version/summary and objective/constraint metadata for this variant.
4. **Upload (if enabled)** via `upload-stock-report`. Reset the session only after a
   confirmed successful upload, per that skill — but note the next iteration's
   `account init` already resets it, so when uploading every run you need no separate
   reset step.
5. **Record** the result in the ledger (§2).
6. **Leave a suggestion** in `suggestions/` about an **app-system or market-data**
   improvement observed during this run — see §5.
7. **Check the stop condition.** If met (or the user said stop), go to §6. Otherwise
   adjust to the next variant and loop. Surface a one-line progress update each
   iteration (variant, edge over benchmark, best so far).

## 5. Leave a suggestion after every run

After each simulation, write exactly one suggestion file to `suggestions/` (the
folder is gitignored — contents not committed). The suggestion is **only** about
improving the **app/system or the market data** — never a trading-strategy idea.

Follow the convention defined in `stock-trade-simulation`
(§"Leave an improvement suggestion"):

- **Path:** `suggestions/<YYYY-MM-DD>-<short-slug>.md` (real-world date; if the name
  exists, append `-2`, `-3`, …).
- **Content:** a short markdown note with the category (`app-system` |
  `market-data`), the simulation it came from (strategy + session id, and report id
  if uploaded), the concrete observation that motivated it, the proposed
  improvement, and a rough priority. Ground it in something you actually hit during
  the run (a missing screen filter, the data end-date boundary, no liquidity/volume
  field, survivorship bias in the universe, a CLI rough edge, etc.). If a run
  surfaced nothing new, write a one-line note saying so rather than inventing a
  duplicate.

## 6. Termination and summary

When the stop condition fires or the user says stop:

- **Finish the in-flight run cleanly** (build + report + suggestion); never abandon a
  half-done simulation.
- **Produce a leaderboard** of every variant tried: ranked by edge over the
  benchmark and by risk-adjusted return, with the parameter that drove each result.
  Call out the best variant and the clearest dead ends.
- **Point to `suggestions/`** for the accumulated app/market-data improvement notes.
- Leave the default session holding the last completed run for UI inspection (unless
  the upload skill already reset it after a successful upload).

## Guardrails

- One simulation at a time on the default session; never parallelize.
- Every variant is mechanical and no-hindsight (no name-level reverse hindsight for
  "bad" controls).
- Judge variants on relative, risk-adjusted performance — absolute returns are
  inflated by survivorship bias in the universe.
- Each run leaves exactly one `suggestions/` note, app/market-data only — never a
  strategy suggestion.
- Honor the agreed stop condition; when none is set, keep going until told to stop
  and check in after every run.
- Build a report only at a run's true end date, and upload only with the user's
  secret key per `upload-stock-report` (production only).
