# CLI Commands Reference

This document describes the StockSimulate2026 CLI. It is written for an AI agent
driving the simulator (e.g. running automated trading simulations), so it
focuses on exact invocation, inputs, outputs, exit codes, and the machine-readable
`--json` mode.

## How to run

Three modes, same commands:

- **One-shot (preferred for automation):** run a single command and exit.
  ```bash
  npm run cli -- <command> [args...]
  ```
  For automation, add npm's `--silent` so npm's own `> tsx ...` lifecycle banner
  is suppressed and stdout is *only* the command output:
  ```bash
  npm run --silent cli -- <command> [args...] --json
  ```
  In `--json` mode the payload is printed verbatim (no ANSI color codes), so the
  output parses directly as JSON without any stripping.
- **Batch:** run a sequence of commands from a file (one per line; blank lines
  and `#` comments are skipped; each line is echoed). Exits non-zero if any line
  failed.
  ```bash
  npm run cli -- batch <file>
  ```
- **Interactive shell:** opens a `stocksimulate>` prompt that reads one command
  per line until `exit`/`quit`. Piping lines into it also works.
  ```bash
  npm run cli
  ```

Exit codes (one-shot/batch set the process exit code):

- `0` — success.
- `1` — failure or invalid usage. The human message is printed to stdout.

## Global flags

These can appear anywhere in a command:

- **`--json`** — emit a structured JSON payload instead of human text. Read
  commands return their full data object; mutations return a result object;
  commands without structured data return `{ "message": "..." }`, and failures
  return `{ "error": "..." }`. Always prefer `--json` when parsing output.
- **`--session=<name>`** — operate on an isolated named session instead of the
  default. Files live side by side under `user-sessions/`: `<name>.json`,
  `<name>.history.log`, `<name>.values.log`. Use this to run parallel scenarios
  without disturbing the default account. The flag applies to that one command
  only. The browser UI always uses the default session.

## Core concepts

- **Session file** `user-sessions/default.json` (or `<name>.json`) holds the
  account state read/written by every account command:
  - `date` — the **simulated date** (`YYYY-MM-DD`). All trades and stock lookups
    are priced/reported **as of this date**.
  - `cash` — available cash.
  - `positions` — held lots per stock, each with `quantity`, `cost_per_share`,
    `purchase_date`.
- **Audit log** `user-sessions/history.log` — append-only, one line per event
  (BUY, SELL, DIVIDEND, DEPOSIT). See [History log format](#history-log-format).
- **Value log** `user-sessions/values.log` — daily total portfolio value, the
  source for `values show`.
- **Report file** `user-sessions/report.json` — compact simulation summary
  artifact built by `report build` for storage, review, or later agent study.
- **Market data** is served from the project database via the PHP API (no local
  files). Each `stock status`/`history`/`price`/`compare`/`screen` reads close +
  dividends + TTM EPS + P/E + shares outstanding + market cap **as of the simulated
  date**. Market cap is reported in USD millions; names without share data (e.g.
  index members/ETFs) have none.
- **Pricing rule:** trades execute at the close on the simulated `date`. If that
  date is not a trading day for the stock, the command fails; advance with
  `date next` to land on one.
- **Dividends are automatic:** advancing the date (`date next` / `date set`)
  credits cash dividends on every payout date stepped over, and reports them.

## Command reference

### Account

| Command | Effect |
| --- | --- |
| `account show` | Holdings table (basis, value, P/L, P/E, day change) as of the sim date. `--json` returns the full view (account + rows + summary). |
| `account buy <code> <qty>` | Buy `qty` shares at the sim-date close. |
| `account buy <code> --amount=<dollars>` | Buy as many whole shares as `<dollars>` affords at the sim-date close. |
| `account buy <code> max` | Buy as many whole shares as all available cash affords. |
| `account sell <code> <qty>` | Sell `qty` shares (FIFO across lots). |
| `account sell <code> all` | Sell the entire position in `<code>`. |
| `account sell <code> --percent=<p>` | Sell `floor(owned × p/100)` shares. |
| `account deposit <cash>` | Add `<cash>` (negative withdraws). Accepts `--note=<text>` to annotate the DEPOSIT history row (e.g. a recurring contribution). |
| `account init` | Reset to a clean slate: empty the entire `user-sessions/` directory (every session, log, and report) and write a fresh default account (`date` `2001-01-02`, `cash` `0`, no positions). |

Buy/sell extras (any order):

- **`--note=<text>`** — free-text annotation recorded on the resulting history
  row(s). Quote multi-word notes: `--note="buy the dip"`.
- **`--dry-run`** — validate and report the price/quantity/cost without making
  any changes.

Success output: `<qty> stocks of <CODE> successfully bought.` / `...sold.`

### Date (simulation clock)

| Command | Effect |
| --- | --- |
| `date show` | Print the current simulated date. |
| `date next [n]` | Advance `n` trading days (default 1), crediting dividends along the way. |
| `date set <yyyy-mm-dd>` | Advance forward to a target day (dividends credited on each payout between). Cannot move backward. |

### Stock data

| Command | Effect |
| --- | --- |
| `stock list` | List every available stock code (`--json` returns the array). |
| `stock info <code>` | Show the stock's profile from the database: company name, segment (sector), industry, and a short description. |
| `stock price <code>` | One-line close + day change for the sim date. |
| `stock status <code>` | Fuller snapshot: close, day change, P/E, TTM EPS, dividend, as of the sim date (falls back to the most recent prior trading day). |
| `stock history <code>` | Daily series from the start of the stock's data through the sim date. |
| `stock compare <code> [<code>...]` | Side-by-side table of several stocks' sim-date figures. |
| `stock screen [filters]` | Screen all stocks. Filters: `--max-pe=`, `--min-pe=`, `--max-price=`, `--min-price=`, `--min-cap=`/`--max-cap=` (market cap in **billions**), `--dividends` (payers only), `--limit=`. |

> **Legacy (pre-v2):** `stock download`, `stock scrape-eps`, `stock build`, and
> `stock seed` belonged to the old local `market-data/` acquisition pipeline. In v2
> all price/EPS/dividend data is served from the database, so these commands are no
> longer part of the workflow (they would write to a `market-data/` folder nothing
> reads). They remain in the CLI only for historical reference.

### Values & history

| Command | Effect |
| --- | --- |
| `values show` | Daily total-value series plus a return summary (start → now, %, high/low). `--json` returns the full summary. |
| `history show [filters]` | Recorded activity. Filters: `--type=<BUY\|SELL\|DIVIDEND\|DEPOSIT>`, `--stock=<CODE>`, `--since=<date>`, `--until=<date>` (compared against the simulated date), `--limit=<n>` (most recent n). |
| `report build [flags]` | Build `report.json` for the active session. Flags: `--out=<path>`, `--strategy=<name>`, `--strategy-version=<version>`, `--strategy-summary=<text>`, `--objective=<title>`, `--objective-metric=<metric>`, `--objective-constraint=<text>` (repeatable), `--market-regime=<label>`, `--volatility-level=<label>`, `--note=<text>`. `--json` returns the full report payload. |

### Other

| Command | Effect |
| --- | --- |
| `help` | List all commands. |
| `exit` / `quit` | Leave the interactive shell. |

## History log format

Space-separated `key=value` tokens; only relevant fields appear. The optional
`note` is JSON-quoted and always last so multi-word notes stay on one line.

```text
2026-06-17T13:00:41Z BUY stock=AAPL qty=10 price=81.24 cash=-812.38 sim=2020-02-14 note="entering on the dip"
2026-06-17T13:00:42Z SELL stock=AAPL qty=10 price=81.24 acquired=2016-01-05 term=LONG cash=+812.38 sim=2020-02-14
2026-06-17T13:00:43Z DIVIDEND stock=T qty=200 price=0.52 cash=+104.00 sim=2020-02-18
```

- Leading token is the real-world timestamp; `sim=` is the simulated date.
- `cash=` is the signed cash impact; `term=` is `SHORT`/`LONG` on sells.

## report.json shape

`report build` writes (and `--json` returns) a single object with these
top-level keys. Note the date fields are `simStartDate`/`simEndDate` (not
`startDate`/`endDate`), and `positions` is an **object** (`{ asOfDate, rows }`),
not a bare array — `positions.rows` is the per-holding list.

```jsonc
{
  "reportVersion": 1,
  "sessionId": "default",
  "objective":        { "title", "primaryMetric", "constraints": [string] },
  "strategy":         { "name", "version", "summary" },
  "thesis":           { "summary", "beliefs": [string] },
  "simulation":       { "simStartDate", "simEndDate", "startedAt", "finishedAt",
                        "startingValue", "endingCash", "endingValue",
                        "totalReturnPct", "annualizedReturnPct" },
  "activity":         { "historyEventCount", "buyCount", "sellCount",
                        "dividendCount", "interestCount",
                        "corporateActionCount", "uniqueStocksTraded" },
  "portfolioSummary": { "principal", "currentTotal", "totalGainLoss",
                        "totalReturnPct", "annualizedReturnPct",
                        "unrealizedGainLoss", "unrealizedGainLossPct" },
  "benchmark":        { "stockCode", "endingValue", "annualizedReturnPct",
                        "methodology" },        // built-in SPY on the DEPOSIT cashflow schedule
  "portfolio":        { "openPositionCount", "cashPct", "largestPositionPct",
                        "maxDrawdownPct" },
  "positions":        { "asOfDate", "rows": [ /* one object per holding */ ] },
  "taxes":            { "longTermGain", "shortTermGain", "dividendGain",
                        "interestGain", "longTermTax", "shortTermTax",
                        "dividendTax", "interestTax", "estimatedTax" },
  "takeaways":        { "summary", "worked": [], "didNotWork": [], "nextChanges": [] },
  "agentLearning":    { "reuseScore", "improvementPotentialScore",
                        "confidenceScore", "tags": [string] },
  "context":          { "marketRegime", "volatilityLevel" },
  "note":             "string"
}
```

## Typical automation loop (JSON-driven)

```bash
# Run an isolated scenario in its own session, parsing JSON at each step.
npm run cli -- account init --session=run1
npm run cli -- account deposit 100000 --session=run1
npm run cli -- date set 2020-02-14 --session=run1

# Observe, decide, act — read JSON, then size the order in dollars.
npm run cli -- stock price AAPL --session=run1 --json
npm run cli -- account buy AAPL --amount=50000 --session=run1 --note="thesis: oversold" --json

# Advance time (dividends auto-credited) and review performance.
npm run cli -- date next 20 --session=run1 --json
npm run cli -- values show --session=run1 --json
npm run cli -- account show --session=run1 --json
```

Or script the whole plan in a batch file and run it once:

```text
# plan.txt
account init --session=run1
account deposit 100000 --session=run1
date set 2020-02-14 --session=run1
account buy AAPL --amount=50000 --session=run1 --note="oversold"
date next 20 --session=run1
values show --session=run1
```

```bash
npm run cli -- batch plan.txt
```
