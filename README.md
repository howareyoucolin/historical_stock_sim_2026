# StockSimulate2026

Small Next.js 13 app-router project running on port `8600`. It simulates trading a
frozen historical dataset (2001-01-02 → 2026-06-26) sourced from the project
database via the PHP API.

## Prerequisites

- **Node.js 18+** and npm. The app and CLI fetch market data over HTTP, which needs
  a global `fetch` (Node 18+; the repo targets Node 22 — `nvm use 22`).
- The **market-data backend running**: the PHP site + MySQL (docker compose in
  `../stock_report_website`). The app/CLI read prices from its API at
  `http://localhost:8700` by default (override with `MARKET_DATA_API_BASE`).
- The repo-root `./dev.sh` brings up the Docker backend and this app together.

Install dependencies:

```bash
npm install
```

## Local Development

```bash
npm run dev          # dev server at http://localhost:8600 (needs the PHP API up)
```

Or from the repo root, start the backend + app in one go:

```bash
./dev.sh
```

## CLI

```bash
npm run cli                  # interactive shell
npm run cli -- help          # one-shot command
npm run cli -- account show --json
```

Common commands (see `commands.md` for the full surface):

- `account init` — reset to a clean slate (empties `user-sessions/`, fresh account at `2001-01-02`).
- `account deposit 200000` / `account buy AAPL 10` / `account sell AAPL all`
- `date next 5` / `date set 2019-08-15` — advance the simulated clock.
- `stock status AAPL` / `stock history AAPL` / `stock screen --max-pe=20` — observe, bounded to the sim date.
- `report build` — write `user-sessions/report.json` for a completed run.

Market data (prices, dividends, EPS, market cap) comes from the database via the API
and is bounded to the simulated date — there are no local data files to download.
(The legacy `stock download`/`scrape-eps`/`build`/`seed` commands belonged to the
pre-v2 local pipeline and are no longer part of the workflow.)

## Scoring Autopilot (V2)

Unattended, self-healing loop that invents and backtests regime-aware scoring scripts and
publishes results to the live board (`https://stock.369usa.com/experiments-v2.php`). Each
iteration: study the prod feed → decide explore/exploit → generate the next script → backtest
across all rolling 5-year windows vs the benchmark → record a lesson → publish → log. See
`.claude/skills/scoring-script-autopilot-v2/SKILL.md` for the methodology.

```bash
npm run autopilot          # run it (self-healing): Codex generates each script, publishes to prod
npm run autopilot:sweep    # no-AI mode: deterministic parameter sweep (free, no Codex)
npm run autopilot:test     # safe check: one dry-run iteration, no publish, no Codex, no number used
```

**Steer a run toward a focus** with `--message` (persists for the whole session, survives restarts):

```bash
npm run autopilot --message="focus on low-vol dividend names in risk-off regimes"
```

The directive is injected into the generator prompt so the AI skews toward it, while the
explore/exploit scaffolding stays mechanical. (Only affects the Codex generator; the sweep ignores it.)

**Watch it remotely** at `https://stock.369usa.com/logs.php` — the live log page (green "Live" /
red "STALE >5m"). To feed it, run the 1-minute log pusher on this machine via cron:

```cron
* * * * * cd /path/to/stock_report_website && ./deploy/push_logs.sh >/dev/null 2>&1
```

**Self-healing:** `npm run autopilot` runs under `tools/approved/watchdog.sh`, which restarts the
loop if it stalls for 5 min. Per-step timeouts + retry/skip mean one bad generation or backtest
never wedges the run; numbering resumes from the prod feed after any restart. Stop with `Ctrl-C`.

Prerequisites: the Docker backend up (the `autopilot*` scripts start it for you), and for the
default Codex generator, the `codex` CLI installed and authenticated. The interim benchmark is a
cap-weight proxy until real SPY data lands (`tools/data/README.md`).

## Production Build

```bash
npm run build        # type-checked production build
npm start            # serve the build on http://localhost:8600
```

## Tests

```bash
npm test             # tsx app/test.ts — all suites (needs Node 18+)
```

Tests inject in-memory fakes for the market-data API; the runner blocks real network
access so an un-injected data dependency fails loudly instead of hitting the API.

## Project Structure

- `app/` — Next.js App Router UI, plus `app/actions/` (reusable CLI/UI logic).
- `app/actions/stock/market-data-client.ts` — the single client for the PHP data API.
- `cli/` — TypeScript CLI entrypoint and controller-style command dispatch.
- `tools/` — reusable analysis tool library (date-capped DB access). See `tools/README.md`.
  Scoring autopilot lives here: `tools/approved/run_autopilot.py` (supervisor), `watchdog.sh`
  (self-heal), `alog.py` (logger), `scoring_lab_v2.py` (backtest runner).
- `user-sessions/` — the active simulation's account, logs, and report (git-ignored).

## Tech Stack

- Next.js 13 · React 18 · TypeScript

## Useful Notes

- Uses the Next.js App Router under `app/`; type checking is part of the build.
- `npm` is used because `package-lock.json` is checked in.
- `.next/` build output and `user-sessions/` are git-ignored.

## Troubleshooting

- `fetch is not defined` → you're on Node < 18; run `nvm use 22`.
- "Could not reach the market-data API" → the PHP backend isn't up; start it
  (`../stock_report_website` docker compose) or use `./dev.sh`.
- If the dev server won't start, confirm port `8600` is free.
- Autopilot restarts itself mid-generation → the watchdog's `STALE_SECS` must exceed one
  iteration's worst case (`--gen-timeout` + `--bt-timeout`); the defaults (900 vs 300+300) are
  balanced, so raise `STALE_SECS` if you raise the timeouts.
- Autopilot generation fails immediately → the `codex` CLI isn't installed/authenticated; verify
  `codex exec --help`, or run `npm run autopilot:sweep` (no Codex) instead.
- Autopilot log page shows STALE but it's running → the 1-minute `push_logs.sh` cron isn't set up
  (see the Scoring Autopilot section).
