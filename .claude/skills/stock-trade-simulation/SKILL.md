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
   - **End date / time horizon** (required — the run loop depends on it).
   - Whether the extra first-day deposit is one-time or a recurring contribution
     (and its cadence), since the default below is a single one-time deposit.
   Favor strategies expressed as mechanical rules over discretionary calls — they
   are easier to execute faithfully and to audit.
2. **Confirm setup overrides** (use these defaults unless the user says otherwise):
   - Start date: `2016-01-04`
   - Initial cash deposit: `200000`
   - Additional first-day deposit: `2500` (one-time)
3. **Refresh:** `account init` — resets the account and wipes the history and
   value logs for a clean run.
4. **Set the start date** if it differs from the post-init default. If the chosen
   start date is not a trading day, land on the closest *next* trading day before
   depositing or trading (`date set <date>` steps forward to the next trading day).
5. **Fund on that first trading day**, as two deposits so the audit trail is
   explicit: `account deposit 200000`, then `account deposit 2500` (or the user's
   amounts). A batch file is a good way to run setup in one shot.

## 2. Run the simulation (observe → decide → act → advance)

- **Observe** with the stock commands (`stock list`, `stock status`,
  `stock price`, `stock history`, `stock compare`, `stock screen`) and account
  commands (`account show`, `values show`, `history show`) — all with `--json`.
- **Decide from what you observed.** Base each trade on the figures you just read
  (price, P/E, trend, the strategy's rules) — never on outside knowledge.
- **Act** with `account buy` / `account sell` (`--amount=`, `max`, `all`,
  `--percent=` as the strategy calls for; preview risky moves with `--dry-run`).
  Trades only work on a trading day, so always be on one first.
- **Verify** each trade executed: re-check `account show --json` (cash and
  position changed as expected). CLI commands can fail (insufficient cash,
  non-trading day, no data) — react to failures, don't assume success.
- **Advance** with `date next <n>` (see pacing below) — dividends are credited
  automatically and reported; re-observe after advancing since prices only move
  with the date.

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

### End condition

After each advance, read the current date with `date show --json` and stop once it
reaches or passes the agreed end date (a random hop may overshoot it — that is
fine). Also stop cleanly if the CLI reports no further trading day is available
(the data has run out). Then go to step 4.

## 3. Notes on trades

When you buy or sell, attach `--note="..."` **only when** the decision carries a
useful insight worth recording (the thesis, the signal you acted on, a risk you
were managing). Skip routine/mechanical trades — quality over quantity. These
notes are also how the user audits that your decisions came from observed data.

## 4. End of simulation

- **Do not reset or clean up.** Leave the account, history, and value logs exactly
  as the run left them in the default session — the user investigates the details
  in the UI.
- **Produce a final research report** covering: the strategy as run; the setup
  (start date, deposits, end date); key decisions and notable trades; dividends
  received; final cash/holdings and total return (`account show`, `values show`);
  and what worked or didn't.
- **Deliver it both ways:** always output the full report inline in the chat, and
  also email it to `howareyoucolin@gmail.com` (subject like
  `Stock Trade Simulation Report — <start> to <end>`) using the available
  email/Gmail integration. If no email integration is available, say so — the
  inline report is the fallback. Mention that the run is left in the default
  session for UI investigation.

## Guardrails

- Never read source code or data files to inform decisions (CLI only).
- Never use post-date / real-world knowledge; keep decisions traceable to observed data.
- Maximize gain *within* the strategy's rules — don't override the strategy.
- Always run on the default session; never reset the data at the end.
- Ask for and confirm the strategy and end date before the first trade.
