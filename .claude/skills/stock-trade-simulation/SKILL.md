---
name: stock-trade-simulation
description: Run an automated stock trade simulation through this project's CLI, role-playing an investor living at the simulated date with no future knowledge, trading toward the best possible gain within a user-supplied strategy. Use when the user asks to start/run a trade simulation, backtest a strategy, or "simulate trading". Agent-agnostic — used by both Claude and Codex. See commands.md for the full command surface.
---

# Stock Trade Simulation

Drive an automated stock trade simulation using only this project's CLI. You play
an investor who lives on the simulated date and is trying to grow the account as
much as possible **within the rules of the strategy the user gives you** (do not
override the strategy to chase gains). The full command reference is in
`commands.md` at the repo root — read it first.

## Hard rules (read before doing anything)

- **CLI only.** Interact with the system *only* through CLI commands
  (`npm run cli -- <command> ...`, or a batch file). Do NOT read or run source
  code, and do NOT open data files directly. The only exception is diagnosing a
  genuine technical issue with the CLI itself.
- **Never read the future.** Do not open files under `market-data/` or
  `user-sessions/` — `market-data/<CODE>/data.json` holds each stock's *entire
  future* history, and reading it is cheating. Your only knowledge of a stock is
  what the stock commands return, and those are already bounded to the simulated
  date.
- **No hindsight.** Role-play someone living on the simulated date with zero
  knowledge of what happens next. Do not use real-world memory of how these
  tickers actually performed after that date. Note: this is the hardest rule to
  hold and cannot be fully verified — enforce it on yourself by making every
  decision *traceable to data you just observed* (see below), not to a ticker's
  reputation. When in doubt, prefer a mechanical, rule-based reading of the data.
- **Default session.** Run on the default session (do NOT pass `--session`); the
  user inspects results in the browser UI, which reads the default session.
- **Prefer `--json`.** Run observe commands with `--json` so you parse state
  reliably.

## 1. Start a simulation (setup)

When the user asks to start a new simulation:

1. **Ask for the strategy first, and confirm the run parameters.** Do not trade
   until these are clear:
   - The strategy itself: which stocks/sectors, entry and exit rules, position
     sizing, risk limits, rebalance cadence.
   - **End date / time horizon** — defaults to the last available trading day,
     which is `2026-06-12` right now, unless the user specifies otherwise; the run
     loop advances until this date is reached. Note the `end` in
     `config/download-date-range.json` (`2026-06-15`) is the *exclusive* download
     boundary, so the last trading day with data is the day before it
     (`2026-06-12`) — target that, not the config value, or the final `date next`
     will fail with no trading day available.
   - The contribution schedule, only if the user wants to change it: the default
     is a recurring `2500` deposit on the first trading day of every month (see
     below). Confirm a different amount, cadence, or a one-time-only deposit only
     when the user asks.
   Favor strategies expressed as mechanical rules over discretionary calls — they
   are easier to execute faithfully and to audit.
2. **Confirm setup overrides** (use these defaults unless the user says otherwise):
   - Start date: `2016-01-04`
   - End date: the last available trading day, currently `2026-06-12` (the day
     before the exclusive `2026-06-15` download boundary)
   - Initial cash deposit: `200000`
   - Recurring contribution: `2500` deposited on the first trading day of every
     month, for the whole run (not a one-time deposit). The first month's `2500`
     is added alongside the initial deposit on the start day.
3. **Refresh:** `account init` — resets the account and wipes the history and
   value logs for a clean run.
4. **Set the start date** if it differs from the post-init default. If the chosen
   start date is not a trading day, land on the closest *next* trading day before
   depositing or trading (`date set <date>` steps forward to the next trading day).
5. **Fund on that first trading day**, as two deposits so the audit trail is
   explicit: `account deposit 200000`, then `account deposit 2500` (or the user's
   amounts) — the second is the first month's recurring contribution. A batch
   file is a good way to run setup in one shot. Then keep depositing `2500` on
   the first trading day of every subsequent month during the run (see step 2).

## 2. Run the simulation (observe → decide → act → advance)

- **Observe** with the stock commands (`stock list`, `stock status`,
  `stock price`, `stock history`, `stock compare`, `stock screen`) and account
  commands (`account show`, `values show`, `history show`) — all with `--json`.
- **Decide from what you observed.** Base each trade on the figures you just read
  (price, P/E, trend, market cap, the strategy's rules) — never on outside
  knowledge. Market cap (shown by `stock status`/`compare`/`screen`, filterable
  with `--min-cap`/`--max-cap`) tells you company size: weigh it for risk,
  liquidity, and remaining growth runway (a mega-cap and a small-cap can share a
  price and P/E yet be very different bets).
- **Act** with `account buy` / `account sell` (`--amount=`, `max`, `all`,
  `--percent=` as the strategy calls for; preview risky moves with `--dry-run`).
  Trades only work on a trading day, so always be on one first.
- **Before each sell, explicitly check tax character.** Use the account view and
  history you have observed to judge whether the lot is likely to be
  **short-term** or **long-term**, and weigh that tax cost before deciding to
  exit. When the strategy allows flexibility, prefer a long-term realization over
  a short-term one; when the strategy demands an exit, still sell, but note the
  tax tradeoff in the sell note.
- **Verify** each trade executed: re-check `account show --json` (cash and
  position changed as expected). CLI commands can fail (insufficient cash,
  non-trading day, no data) — react to failures, don't assume success.
- **Advance** with `date next <n>` (see pacing below) — dividends are credited
  automatically and reported; re-observe after advancing since prices only move
  with the date.
- **Make the recurring contribution.** Whenever an advance lands you in a new
  calendar month, `account deposit 2500` on that first observed trading day of
  the month (before buying), then deploy it per the strategy. This continues the
  monthly contribution set up in step 1 (use the user's amount/cadence if they
  overrode it). Track the last month you contributed so you deposit exactly once
  per month.
- **Treat cash as an earning asset, not dead space.** Uninvested cash accrues
  modeled money-market interest over time, so when the strategy is uncertain or
  risk is elevated, compare the expected stock edge against the value of waiting
  in cash rather than assuming every free dollar must be deployed immediately.

### Factor in tax and cash interest

These two real costs/returns affect after-tax results, so weigh them when you
decide — don't optimize on gross price moves alone:

- **Tax on realized gains.** Selling a position realizes a taxable gain or loss,
  classified by holding period: a lot held **one year or less is short-term**
  (taxed at the higher ordinary rate), and **more than a year is long-term**
  (taxed lower). Dividends and cash interest are taxable too. So churn has a tax
  cost: rapid in-and-out trading piles up short-term gains and drags returns.
  Where the strategy allows, prefer letting a winner cross its **one-year mark**
  for long-term treatment, and avoid needless turnover. Realized losses offset
  gains, so harvesting a loser can be tax-efficient. The Summary tab shows
  per-year realized gains and estimated tax by category, mirroring what the run
  produces.
- **Operational rule for sells.** Do not treat two profitable exits as equal if
  one is short-term and the other is long-term. When choosing between holding a
  little longer versus selling now, include the holding-period tax difference in
  the decision. If a stop-loss, thesis break, or hard strategy rule says sell
  now, obey it — but still record the tax-aware reasoning in the trade note.
- **Interest on parked cash.** Uninvested cash earns money-market (SPAXX)
  interest, accrued daily and paid on the first trading day of each month, then
  compounding. So idle cash is not dead weight — it carries a small positive
  yield (more meaningful in higher-rate years). Factor this in when choosing
  between holding cash and deploying: staying partly in cash has a real, if
  modest, return, and that interest is itself taxable.
- **Operational rule for buys.** Do not force a buy just because cash is
  available. If no candidate clearly beats the after-tax, interest-bearing option
  of staying in cash, waiting is a valid strategic choice.

Keep these as inputs to the decision, not overrides of the user's strategy — if a
trade follows the strategy, tax/interest considerations refine *how* and *when*
you act (sizing, timing around the one-year mark), not *whether* to follow it.

### Pace it like a real investor

Do **not** jump ahead with `date set` during the run — landing on a chosen future
date implies you are planning around dates you should not know, breaking the
unknown-future role-play. Instead advance only with `date next <n>`, and **vary
`n` randomly between 1 and 10 trading days** on each hop — mimicking how a real
person checks the market: sometimes daily, sometimes only every week or two.
Fully observe at each check-in and trade if the strategy calls for it. (This also
keeps a multi-year run to a few hundred steps instead of thousands.) Use batch
files for multi-command *setup* sequences, but advance the clock in these
irregular `date next` hops until the end condition is met.

#### Scripted execution for purely mechanical strategies

For a fully mechanical, rule-based strategy (e.g. fixed buckets, market-cap
weighting, a monthly contribution, and a fixed rebalance cadence), a multi-year
run can be hundreds of hops and many hundreds of trades — impractical to drive
turn-by-turn. In that case it is acceptable to drive the run with a **script that
calls the CLI** (the same `npm run cli -- ...` commands) in a loop, *provided it
still honors every guardrail*:

- **CLI only** — the script issues CLI commands; it must not read `market-data/`
  or session files, or import the simulator's source to shortcut a decision.
- **No future knowledge** — each decision uses only data the CLI returns as of
  the simulated date (`stock screen`/`status` figures), never post-date facts.
- **Still pace and contribute** — vary the `date next` hop (1–10), make the
  monthly contribution on the first observed trading day of each new month, and
  attach a data-grounded `--note` to every trade just as a manual run would.
- **React to failures** — check each command's result; a non-zero exit (e.g. the
  data-boundary `date next`) must end the loop cleanly, not crash silently.

This is an execution convenience for mechanical rules, not license to bypass the
role-play: a discretionary strategy should still be driven hop-by-hop.

### End condition

After each advance, read the current date with `date show --json` and stop once it
reaches or passes the agreed end date (a random hop may overshoot it — that is
fine). Also stop cleanly if the CLI reports no further trading day is available
(the data has run out). Then go to step 4.

## 3. Notes on trades

Attach a `--note="..."` to **every** buy and sell that explains *why* you made the
trade: the signal or figures you acted on (price, P/E, trend), how it follows the
strategy's rules, and any risk you were managing. Aim for a normal-sized note — a
sentence or two. Not a terse tag, not a paragraph: just enough to make the action
understandable on its own. Keep it concrete and tied to what you actually
observed, e.g. `--note="Top momentum name, +24% trailing 3mo and still leading the
screen, so entering at an equal-weight slot"` rather than `--note="buy"`. These
notes are how the user follows your reasoning and audits that each decision came
from data you observed. For sells, mention whether the exit is short-term or
long-term when that affects the decision. For buys, mention why deploying cash is
better than continuing to earn interest in cash.

## 4. End of simulation

- **Do not reset or clean up (until the report is uploaded).** Leave the account,
  history, and value logs exactly as the run left them in the default session so
  the user can investigate the details in the UI. The one exception is the
  post-upload reset owned by `.claude/skills/upload-stock-report/SKILL.md`: once
  the report has been **successfully uploaded**, that skill clears the session
  (`account init`) for a clean next start. Never reset before a successful upload.
- **Build the structured report only at the true end of the run.** Once the
  simulation reaches or passes the agreed end date, run `report build` to create
  `report.json` for the completed simulation. Do **not** build a report midway
  through the run just because you paused at an intermediate year or checkpoint;
  many users progress the simulation in stages. The only exception is when the
  user explicitly asks for an interim report before the final end date. Follow
  `.claude/skills/simulation-reporting/SKILL.md` for the report-building
  workflow, metadata flags, and summary expectations.
- **Produce a final research report** covering: the strategy as run; the setup
  (start date, deposits, end date); key decisions and notable trades; dividends
  received; final cash/holdings and total return (`account show`, `values show`);
  and what worked or didn't.
- **Benchmarks — reuse, don't recompute.** `report build` already emits a
  built-in S&P 500 (SPY) benchmark in `report.json` (`benchmark` block), invested
  on the **same DEPOSIT cashflow schedule** with dividends reinvested. Use that as
  the VOO / index comparison — do **not** spin up a separate `--session=voo` run
  to recompute it. For the **default run config** (start `2016-01-04`, end
  `2026-06-12` at the data boundary, `$200,000` initial + `$2,500`/month =
  `$515,000` contributed) the reference terminal values are:
  - **VOO / S&P 500 ≈ `$1,627,832`** (built-in SPY benchmark ≈ `$1,620,924`,
    ~15.4% annualized) — equivalent, so cite the built-in figure.
  - **Static Top-15 (Jan-2016 leaders) buy-and-hold ≈ `$2,024,722`.**

  These cached numbers are valid **only for the default cashflow schedule above**.
  If the user changes the start/end dates, initial deposit, or contribution
  cadence, the built-in SPY benchmark auto-adjusts (just read it from
  `report.json`); recompute the static buy-and-hold figure with a parallel
  session only when needed.
- **Deliver it:** output the full report inline in the chat. Mention that the run
  is left in the default session for UI investigation.

## Guardrails

- Never read source code or data files to inform decisions (CLI only).
- Never use post-date / real-world knowledge; keep decisions traceable to observed data.
- Maximize gain *within* the strategy's rules — don't override the strategy.
- Account for tax (short- vs long-term gains, dividends, interest) and the
  interest earned on parked cash when deciding — optimize after-tax, not gross.
- Always run on the default session; never reset the data at the end — except
  the post-upload `account init` performed by the upload skill once the report
  has been successfully uploaded.
- Ask for and confirm the strategy before the first trade; the end date
  defaults to the last available trading day (currently `2026-06-12`, the day
  before the exclusive `2026-06-15` download boundary) unless the user specifies
  one.
- Only run `report build` after the simulation reaches the final end date, unless
  the user explicitly asks for a report earlier.
