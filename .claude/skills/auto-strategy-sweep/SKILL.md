---
name: auto-strategy-sweep
description: Continuously run as many stock-trade simulations as possible, automatically generating and adjusting strategy variants, until a stop condition is met or the user says stop. Use when the user asks to "auto-simulate", "sweep strategies", "keep running simulations", "explore strategies on autopilot", "try as many strategies as you can", or otherwise wants an open-ended, self-driving batch of simulations rather than one named run. Builds on stock-trade-simulation (per run), simulation-reporting (per report), upload-stock-report (optional), and leaves a suggestion after every run.
---

# Auto Strategy Sweep

Drive an open-ended series of stock-trade simulations on autopilot: pick a
strategy, run it to the end date, report it, leave an app/market-data suggestion,
record the result, then adjust into the next variant — and keep going until a
stop condition fires or the user tells you to stop. This skill is the orchestration
layer; each individual run still follows
`.claude/skills/stock-trade-simulation/SKILL.md` exactly.

## Hard rules (inherit everything from stock-trade-simulation)

Every per-run guardrail from `stock-trade-simulation` applies in full and is
non-negotiable here:

- **CLI only**, never read source or `market-data/` / `user-sessions/` data files.
- **No hindsight.** Every variant must be a mechanical rule decided from data
  observable as of the sim date (trailing returns, P/E, market cap, dividends).
  Never pick or avoid a ticker because of how it really performed. This includes
  "reverse hindsight" — do not engineer a deliberately bad variant by choosing
  names you know cratered; make it bad *by rule*, not by name.
- **Default session, one run at a time.** All runs share the default session, so
  they MUST be strictly sequential — never launch two simulations concurrently.
  Each run begins with `account init` (a clean slate) per the simulation skill.
- **Mechanical variants only.** Favor fully rule-based strategies so the loop can
  be script-driven (see the simulation skill's "Scripted execution" section).
  A discretionary idea is out of scope for the autopilot.

## 1. Confirm the run contract before starting

Before the first run, pin down two things with the user (use sensible defaults and
proceed if they delegate):

1. **Stop condition** — how the autopilot ends. Offer these; default to "run until
   I say stop" if the user gives none, but always surface progress after each run
   so they can interject:
   - **Manual** — keep going until the user says stop (default).
   - **Count** — stop after N simulations.
   - **Time / deadline** — stop at a wall-clock time (e.g. 3 AM). Implement as a
     between-runs check: a run already in flight always finishes; no new run
     starts past the deadline.
   - **Target metric** — stop once a variant clears a bar (e.g. beats the built-in
     SPY benchmark by X, annualized > Y, or max drawdown < Z at a given return).
   - **Convergence** — stop after K consecutive variants fail to improve the best
     risk-adjusted result.
2. **Per-run setup + publishing** — confirm the run config (defaults: start
   `2001-01-02`, `$200,000` + `$2,500`/mo, end `2026-06-26`) and whether to
   **upload each report** (`upload-stock-report`, which requires the secret key —
   ask once and reuse for the session only if the user clearly authorizes
   unattended uploads).

## 2. Keep a sweep ledger

Maintain a running ledger of variants tried so the search adapts and never repeats
itself. Track per variant: the variant id/params, ending value, total &
annualized return, **return vs the built-in SPY benchmark**, max drawdown,
after-tax result, and turnover (buy/sell counts). Store it as a local working file
(e.g. in the scratchpad or a gitignored `user-sessions/`-adjacent log) — it is your
memory across iterations, not a deliverable.

**Judge on relative, risk-adjusted performance, not the raw multiple.** The data
universe is survivorship-biased (it over-represents names that became winners), so
absolute returns are inflated and only comparisons are trustworthy. Rank variants
by their edge over SPY and by drawdown/turnover-adjusted return.

## 3. Generate and adjust variants

Draw from a library of mechanical families and a set of parameter axes; explore
broadly, then hill-climb on what works.

**Families** (each fully rule-based): relative-strength momentum rotation;
dual-momentum (momentum + cash guard); market-cap-weight top-N; equal-weight
top-N; low-volatility / low-beta tilt; value tilt (low P/E); dividend tilt;
sector-bucket allocations; quality (earnings/PE) screens; and deliberate
negative-control anti-patterns for study (e.g. anti-momentum, high-P/E chase,
single-name concentration) — clearly labeled as controls.

**Parameter axes** to vary one at a time around a base: momentum lookback
(e.g. 3/6/12 mo), holding count `top_k`, rebalance cadence
(monthly/quarterly/annual), hysteresis buffer width, weighting (equal vs cap),
universe market-cap floor, the cash/absolute-momentum guard threshold, and
whether winners are trimmed vs let-run (tax turnover).

**Search method (explore/exploit):**
- Start from a reasonable base variant; run it.
- Do **controlled one-axis** variants off the current best (change a single
  parameter) so each result is attributable.
- **Hill-climb**: keep the changes that improve the risk-adjusted edge; discard the
  rest.
- Periodically **inject a fresh family** to avoid a local optimum (exploration).
- Keep every variant traceable to observed data and note its rule in the report's
  strategy metadata.

## 4. The autopilot loop (per iteration)

Run strictly sequentially. For each iteration:

1. **Pick the next variant** from the search logic in §3 (skip anything already in
   the ledger).
2. **Run it** following `stock-trade-simulation` end to end: `account init`,
   fund, then drive the clock with irregular 1–10 day `date next` hops, make the
   monthly contribution, attach a data-grounded `--note` to every trade, and stop
   at the end date. Script the run for mechanical variants.
3. **Build the report** with `report build` per `simulation-reporting`, setting the
   strategy name/version/summary and objective/constraint metadata for this variant.
4. **Upload (if enabled)** via `upload-stock-report`. Only reset the session after a
   confirmed successful upload, per that skill — but note the next iteration's
   `account init` already resets it, so when uploading every run you do not need a
   separate reset step.
5. **Record** the result in the ledger (§2).
6. **Leave a suggestion** in `suggestions/` about an **app-system or market-data**
   improvement observed during this run — see §5.
7. **Check the stop condition.** If met (or the user said stop), go to §6. Otherwise
   adjust to the next variant and loop. Surface a one-line progress update
   (variant, result vs SPY, best so far) each iteration.

## 5. Leave a suggestion after every run

After each simulation, write exactly one suggestion file to `suggestions/`. This
folder is gitignored (contents not committed). The suggestion is **only** about
improving the **app/system or the market data** — never a trading-strategy idea.

Follow the same convention defined in
`stock-trade-simulation` (§"Leave an improvement suggestion"):

- **Path:** `suggestions/<YYYY-MM-DD>-<short-slug>.md` (use the real-world date;
  if the name exists, append `-2`, `-3`, …).
- **Content:** a short markdown note with the category
  (`app-system` | `market-data`), the simulation it came from (strategy + session
  id, and report id if uploaded), the concrete observation that motivated it, the
  proposed improvement, and a rough priority. Ground it in something you actually
  hit during the run (a missing screen filter, the data end-date boundary, no
  liquidity/volume field, survivorship bias in the universe, a CLI rough edge,
  etc.). If a run surfaced nothing new, write a one-line note saying so rather than
  inventing a duplicate.

## 6. Termination and summary

When the stop condition fires or the user says stop:

- **Finish the in-flight run cleanly** (build + report + suggestion); do not abandon
  a half-done simulation.
- **Produce a leaderboard** of every variant tried: ranked by edge over SPY and by
  risk-adjusted return, with the parameter that drove each result. Call out the best
  variant and the clearest dead ends.
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
  secret key per `upload-stock-report`.
