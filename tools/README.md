# Simulator Tool Framework

A growing standard library of small, reusable helper tools for simulation analysis.
The goal: build up vetted, reusable utilities over time instead of writing
disposable one-off scripts per run.

## How it works

- **One tool, one job.** Each tool performs a single well-defined task (load prices,
  compute an indicator, screen stocks, compute portfolio metrics, export a report…).
- **Reuse first.** Before writing anything, check [`docs/TOOLS.md`](docs/TOOLS.md).
  Prefer extending an existing tool over creating a duplicate.
- **New tools start unapproved.** AI-generated tools go in `unapproved/<category>/`
  (git-ignored, pending review). An administrator promotes vetted ones into
  `approved/<category>/` (git-tracked, production-ready) and updates the catalog.

```
tools/
  approved/     reviewed, git-tracked, safe to reuse
  unapproved/   AI-generated, pending review (contents git-ignored)
  docs/TOOLS.md the catalog — the index of every tool
```

Both `approved/` and `unapproved/` share the categories:
`database/ indicators/ financials/ portfolio/ screening/ reporting/ utilities/`.

## The cardinal rule — no hindsight, ever

**A tool must never read data dated after the current simulation date.** This is
non-negotiable; a future-dated read invalidates the entire run.

The framework enforces this in code, not by convention: all DB access goes through
[`approved/database/db.py`](approved/database/db.py), whose `fetch()` automatically
caps every read at the simulation date and clamps any caller-supplied `as_of` to
`min(as_of, sim_date)`. A tool physically cannot pull future rows through it.

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

Use reusable data-access tools (e.g. `database/price_loader.py`) instead of issuing
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
python3 tools/approved/database/price_loader.py AAPL --json

# In a tool:
import sys; sys.path.insert(0, "tools/approved/database")
import db
rows = db.fetch("stock_daily_prices", ["trade_date", "close"],
                where="stock_id = :id", params={"id": 1})  # always <= sim date
```
