# Simulator Tool Framework

A growing standard library of small, reusable helper tools for simulation analysis.
The goal: build up vetted, reusable utilities over time instead of writing
disposable one-off scripts per run.

## How it works

- **One tool, one job.** Each tool performs a single well-defined task (load prices,
  compute an indicator, screen stocks, compute portfolio metrics, export a report…).
- **Reuse first.** Before writing anything, check [`docs/TOOLS.md`](docs/TOOLS.md)
  (approved tools) and `unapproved/INDEX.md` (pending ones). Prefer extending an
  existing tool over creating a duplicate.
- **New tools start unapproved — and untracked.** AI-generated tools go directly in
  `unapproved/` (git-ignored) and are listed in `unapproved/INDEX.md` (also
  git-ignored). Creating one produces **no git changes**. An administrator promotes
  vetted ones into `approved/` (git-tracked), which is the only step that adds a tool
  to version control and the tracked catalog.

```
tools/
  approved/            reviewed, git-tracked, safe to reuse
  docs/TOOLS.md        catalog of APPROVED tools (tracked)
  unapproved/          AI-generated, pending review — git-ignored
  unapproved/INDEX.md  list of pending tools — git-ignored
```

Both folders are flat (no category subfolders), so a newly added script under
`unapproved/` is easy to spot at a glance.

## The cardinal rule — no hindsight, ever

**A tool must never read data dated after the current simulation date.** This is
non-negotiable; a future-dated read invalidates the entire run.

The framework enforces this in code, not by convention: all DB access goes through
[`approved/db.py`](approved/db.py), whose `fetch()` automatically caps every read at
the simulation date and clamps any caller-supplied `as_of` to `min(as_of, sim_date)`.
A tool physically cannot pull future rows through it.

```
Simulation date 2019-08-15  →  allowed: <= 2019-08-15   forbidden: > 2019-08-15
```

The current simulation date is read from the active session
(`user-sessions/meta.json`) — it is the single source of truth and cannot be
overridden by a caller.

## Preferred architecture

```
Agent  →  Price Loader / data-access tool  →  Database
```

Use reusable data-access tools (e.g. `approved/price_loader.py`) instead of issuing
raw SQL. This centralizes the date cap and validation, survives schema changes, and
encourages reuse. `db.run_sql()` is a low-level escape hatch — if you use it
directly you are responsible for the date cap, so avoid it for dated data.

## Design principles

- One clear responsibility; deterministic where possible.
- No side effects unless explicitly intended.
- Reusable by future runs and documented in `docs/TOOLS.md` so future agents can
  find it.
- Configure DB connection via env if your setup differs: `STOCKAI_DB_CONTAINER`,
  `STOCKAI_DB_NAME`, `STOCKAI_DB_USER`, `STOCKAI_DB_PASS` (defaults target the
  project's docker MySQL).

## Quick start

```bash
# Load a symbol's prices capped at the current simulation date:
python3 tools/approved/price_loader.py AAPL --json

# In a tool:
import sys; sys.path.insert(0, "tools/approved")
import db
rows = db.fetch("stock_daily_prices", ["trade_date", "close"],
                where="stock_id = :id", params={"id": 1})  # always <= sim date
```
