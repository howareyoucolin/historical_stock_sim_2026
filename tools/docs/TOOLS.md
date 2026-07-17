# Tool Catalog (Approved tools)

Index of **approved** reusable simulator tools — the git-tracked, reviewed ones in
`approved/`. **Consult this file before creating a new tool** to avoid duplicates;
prefer extending an existing tool over writing a new one.

Unapproved (AI-generated, pending review) tools are **not listed here** — they live
in `unapproved/` (flat, git-ignored) and are described in `unapproved/INDEX.md`
(also git-ignored). Keeping them out of this tracked file means creating a new tool
produces **no git changes** until an administrator promotes it. Also check
`unapproved/` (and its INDEX) before writing something new.

> **Cardinal rule:** every tool that loads dated data MUST cap results at the current
> simulation date. Never return rows dated after it.
>
> Two sanctioned data paths satisfy this: **(a) data-access tools** read the DB through
> `approved/db.py`, which hard-caps every read at the sim date; **(b) CLI run-drivers**
> (`cli_shell` and the backtesters below) go only through `npm run cli`, whose stock/account
> data is already bounded to the simulated date — they never touch the DB directly. Both
> honor no-look-ahead; pick (a) for indicators/screens, (b) for driving trade simulations.

| Tool | Purpose | Inputs | Outputs | Location | Status |
|------|---------|--------|---------|----------|--------|
| `db` | Date-safe DB access layer. `simulation_date()` + `fetch()` that hard-caps every read at the sim date (clamps any `as_of` to `min(as_of, sim_date)`). The foundation all data-access tools build on. | table, columns, where/params, `as_of` (optional) | list of dict rows, all dated ≤ sim date | `approved/db.py` | Approved |
| `price_loader` | Load a stock's daily price history (close/adj_close/volume), capped at the sim date. The canonical Agent → Price Loader → Database path. | `symbol`, `--as-of` (optional), `--limit`, `--json` | daily bars (oldest-first), JSON or table | `approved/price_loader.py` | Approved |
| `cli_shell` | Persistent `npm run cli` interactive-shell driver (Python). Launches the CLI once and does request/response, so the tsx startup cost is paid once, not per command. The shared CLI-only access path the run drivers below build on (honors the sim-date bound; no DB access). | `Shell(session=...)`, `.cmd()`, `.js()` | parsed CLI output (dict/list/str) | `approved/cli_shell.py` | Approved |
| `build_price_panel` | Build a local price/fundamentals panel once by pulling `stock history` (a sim-date-bounded stock command) for every code with reader sessions parked at the data boundary. One panel serves every rolling window; the backtesters slice `date <= checkpoint` for look-ahead-free walk-forward. CLI-only (via `cli_shell`), not the DB. | `--boundary`, `--workers`, `--out`, `--limit` | JSON `{code:{d,c,e,p,m}}` panel | `approved/build_price_panel.py` | Approved |
| `dip_backtest` | Mechanical "Buy the Dip" backtester: walks a rolling window forward (as-of slicing = no look-ahead) and executes real trades on a session via the CLI, then `report build`. Quality gate is fundamental (EPS>0 & cap≥floor) where data exists, else a price/longevity proxy; equal-weight top-N of names 30–50% below their 52-wk high; monthly contributions; `band` or `hold`-winners exit. | `--start`, `--years`, `--panel`, `--session`, `--gate`, `--cap-floor`, `--top-n`, `--dip-min/max`, `--exit-mode`, `--sizing`, `--hop-min/max`, `--strategy-version` | `report.json` on the session + ledger row + RESULT | `approved/dip_backtest.py` | Approved |
| `index_topn` | Cap-weighted Top-N mega-cap "index fund" backtester: each month hold the N largest by market cap, weight proportionally to cap, drop names leaving the top-N; deploy monthly contributions toward cap weights; no trimming. Pre-cap era falls back to a flagged price proxy. CLI-executed, look-ahead-free. Reuses `dip_backtest`'s `Panel`/date helpers + `cli_shell`. | `--start`, `--years`, `--panel`, `--session`, `--top-n`, `--gate`, `--hop-min/max`, `--strategy-version` | `report.json` on the session + ledger row + RESULT | `approved/index_topn.py` | Approved |
| `top_marketcap` | Rank stocks by most recent quarterly market cap visible as of the simulation date, with optional sector filtering. Reads the DB through `db.fetch`, so it stays no-look-ahead safe. | `--sector`, `--limit`, `--as-of`, `--json` | ranked rows `{symbol, sector, industry, marketCap, asOfQuarter}` | `approved/top_marketcap.py` | Approved |
| `sp500_membership_changes` | Compute the point-in-time S&P 500 join/leave diff between the two most recent visible membership snapshots. Explicitly caps `snapshot_date` to the simulation date because this table is not auto-capped in `db.py`. | `--as-of`, `--members`, `--json` | `{latestSnapshot, previousSnapshot, joined[], left[], members?[]}` | `approved/sp500_membership_changes.py` | Approved |
| `tech_top10_index` | No-look-ahead monthly tech-leaders rebalancer: hold the top-N Information Technology names by market cap (or a clearly flagged price proxy pre-cap era), equal-weight, and rebalance monthly through the CLI. Uses the static sector map asset in `approved/sector_map.json`. | `--start`, `--years` or `--end`, `--panel`, `--sector-map`, `--session`, `--top-n`, `--gate`, `--hop-min/max`, `--strategy-version` | `report.json` on the session + ledger row + RESULT | `approved/tech_top10_index.py` | Approved |
| `sector_momentum` | No-look-ahead sector-momentum rotation: each month rank sectors by trailing return, rotate into the leading sector's top-N names, equal-weight, with optional cash guard. Uses the static sector map asset in `approved/sector_map.json`. | `--start`, `--years`, `--panel`, `--sector-map`, `--session`, `--top-n`, `--lookback-months`, `--sector-metric`, `--cash-guard`, `--hop-min/max`, `--strategy-version` | `report.json` on the session + ledger row + RESULT | `approved/sector_momentum.py` | Approved |
| `factor_rank` | Generic no-look-ahead cross-sectional factor-rank backtester: z-score a factor composite as of each month, hold the top-N equal-weight, and rebalance monthly. Includes practical proxy presets built from the panel's close/EPS/P/E/cap data. | `--start`, `--years`, `--panel`, `--session`, `--strategy`, `--top-n`, `--min-cap`, `--min-price`, `--small-min/max`, `--vol-window`, `--hop-min/max`, `--strategy-version` | `report.json` on the session + ledger row + RESULT | `approved/factor_rank.py` | Approved |
| `trend_filter` | No-look-ahead trend-following market filter: hold an equal-weight large-cap market-proxy basket when breadth is above a moving-average threshold, else go to cash. Reuses the panel and CLI path. | `--start`, `--years`, `--panel`, `--session`, `--top-n`, `--ma`, `--breadth`, `--min-price`, `--hop-min/max`, `--strategy-version` | `report.json` on the session + ledger row + RESULT | `approved/trend_filter.py` | Approved |
| `supercycle_rotation` | Hindsight-only thematic rotation control study: rotate through retrospectively leading supercycle baskets with a deliberate 1-year lag. Useful as a foresight ceiling, not an implementable strategy. | `--start`, `--years`, `--panel`, `--session`, `--hop-min/max`, `--strategy-version` | `report.json` on the session + ledger row + RESULT | `approved/supercycle_rotation.py` | Approved |
| `aggregate_sweep` | Aggregate factor/backtest sweep results from preserved session ledgers and upload logs, then build leaderboard CSV/JSON/Markdown outputs in the git-ignored sweep output directory. | `--out-dir` | `leaderboard.csv`, `leaderboard.json`, `leaderboard.md` | `approved/aggregate_sweep.py` | Approved |
| `autopilot_factor_lab` | Deterministic unattended multi-wave factor lab. Runs a fixed agenda of factor and sector-rotation sweeps across the default 5-year windows, uploads reports, and refreshes the leaderboard. Writes only to git-ignored output directories. | none (uses repo-local `.env`, `tools/unapproved/price_panel.json`, and `approved/sector_map.json`) | session folders, `sweep_out/*.log`, `sweep_out/*.jsonl`, refreshed leaderboard | `approved/autopilot_factor_lab.sh` | Approved |
| `autopilot_factor_explorer` | Companion unattended explorer that searches adjacent strategy directions in parallel with the main factor lab and refreshes the shared leaderboard. Writes only to git-ignored output directories. | none (uses repo-local `.env`, `tools/unapproved/price_panel.json`, and `approved/sector_map.json`) | session folders, `sweep_out/*.log`, `sweep_out/*.jsonl`, refreshed leaderboard | `approved/autopilot_factor_explorer.sh` | Approved |
| `run_autopilot_demo` | Convenience launcher for the two approved autopilot loops. Starts them if they are not already running and prints the log/leaderboard locations. | none | detached autopilot processes + PID/log files under `sweep_out/` | `approved/run_autopilot_demo.sh` | Approved |
| `continue_sweep` | Resume the older preserved factor sweep agenda, including re-uploads and unfinished windows, using the approved strategy drivers and the cached price panel. | none (uses repo-local `.env`, `tools/unapproved/price_panel.json`, and `approved/sector_map.json`) | refreshed session reports, uploads, and `sweep_out/*.jsonl/.log` | `approved/continue_sweep.sh` | Approved |
| `watch_continue_sweep` | Wait for a detached `continue_sweep` process to finish, then rebuild the leaderboard in the shared sweep output directory. | `<continue_sweep_pid>` | `finalize.log` + refreshed leaderboard files | `approved/watch_continue_sweep.sh` | Approved |

## Adding a tool (checklist)

1. Search this catalog AND `unapproved/INDEX.md` for an existing tool that already does it.
2. If none, create it directly under `unapproved/` (one clear responsibility, no subfolders).
3. For any dated data, go through `db.fetch()` (or a loader built on it) — never
   issue raw, uncapped SQL.
4. Add a short entry to `unapproved/INDEX.md` (git-ignored) — **do not edit this file**,
   so tool creation leaves the git tree clean.
5. To promote: the administrator moves the tool into `approved/`, adds its row to the
   table above, and removes its `unapproved/INDEX.md` entry. That promotion is the
   only step that makes a tool git-tracked.
