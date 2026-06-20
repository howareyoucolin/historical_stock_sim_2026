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
- **Market data** in `market-data/<CODE>/`: `history.json` (raw closes used to
  price trades) and `data.json` (close + dividends + TTM EPS + P/E + shares
  outstanding + market cap, used by
  `stock status`/`history`/`price`/`compare`/`screen`). Market cap is
  `close × sharesOutstanding` (shares from `config/shares-outstanding.json`, an
  approximate current figure per ticker) and is reported in USD millions; ETFs
  have no market cap.
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
| `account deposit <cash>` | Add `<cash>` (negative withdraws). |
| `account init` | Reset the (active session's) account to defaults (`date` `2016-01-04`, `cash` `0`, no positions) and wipe its history + value logs. |

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
| `stock info <code>` | Show the stock's curated basic profile: company name, segment, listing status, and simulation note. |
| `stock price <code>` | One-line close + day change for the sim date. |
| `stock status <code>` | Fuller snapshot: close, day change, P/E, TTM EPS, dividend, as of the sim date (falls back to the most recent prior trading day). |
| `stock history <code>` | Daily series from the start of the stock's data through the sim date. |
| `stock compare <code> [<code>...]` | Side-by-side table of several stocks' sim-date figures. |
| `stock screen [filters]` | Screen all stocks. Filters: `--max-pe=`, `--min-pe=`, `--max-price=`, `--min-price=`, `--min-cap=`/`--max-cap=` (market cap in **billions**), `--dividends` (payers only), `--limit=`. |
| `stock download <code>` | Download price history into `market-data/<code>/history.json`. |
| `stock scrape-eps <code>` | Scrape TTM Net EPS into `eps.json`. |
| `stock build <code>` | Combine `history.json` + `eps.json` into `data.json`. |
| `stock seed` | Run download → scrape-eps → build for every ticker in `config/tickers.json`. |

### Values & history

| Command | Effect |
| --- | --- |
| `values show` | Daily total-value series plus a return summary (start → now, %, high/low). `--json` returns the full summary. |
| `history show [filters]` | Recorded activity. Filters: `--type=<BUY\|SELL\|DIVIDEND\|DEPOSIT>`, `--stock=<CODE>`, `--since=<date>`, `--until=<date>` (compared against the simulated date), `--limit=<n>` (most recent n). |

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
