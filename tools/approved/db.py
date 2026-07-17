"""Date-safe database access for simulator tools — the cornerstone of the framework.

THE CARDINAL RULE
-----------------
No tool may read data dated AFTER the current simulation date. This module enforces
that centrally so a tool *physically cannot* obtain future data, even if asked:

  * `simulation_date()` is the single source of truth (read from the active session).
  * `fetch()` automatically appends a `<date_column> <= <sim_date>` bound for any
    table with a time dimension, and clamps any caller-supplied `as_of` to
    `min(as_of, sim_date)` — it can never reach beyond the simulation date.

Tools should go through `fetch()` (or higher-level loaders built on it) rather than
issuing raw SQL, so date-filtering is guaranteed in one place. A future-dated read is
a hindsight violation that invalidates the run.

Connection: routes through the project's docker MySQL container via `docker exec`
(no Python driver needed). Override via env vars if your setup differs:
STOCKAI_DB_CONTAINER, STOCKAI_DB_NAME, STOCKAI_DB_USER, STOCKAI_DB_PASS.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

# tools/approved/db.py -> parents[2] == the simulator project root.
SIM_ROOT = Path(__file__).resolve().parents[2]
SESSION_META = SIM_ROOT / "user-sessions" / "meta.json"

DB_CONTAINER = os.environ.get("STOCKAI_DB_CONTAINER", "stock_report_mysql")
DB_NAME = os.environ.get("STOCKAI_DB_NAME", "stock_report")
DB_USER = os.environ.get("STOCKAI_DB_USER", "stock_user")
DB_PASS = os.environ.get("STOCKAI_DB_PASS", "stock_pass")

# The time column each table is capped on. Tables absent here have no time dimension
# (e.g. `stocks` is static profile metadata) and carry no hindsight risk.
DATE_COLUMN = {
    "stock_daily_prices": "trade_date",
    "stock_dividends": "ex_date",
    "stock_monthly_metrics": "month_end",
    "stock_quarterly_metrics": "fiscal_quarter",
    "stock_quarterly_market_cap": "fiscal_quarter",
    "stock_corporate_actions": "action_date",
    "stock_market_index": "trade_date",
    "stock_trading_calendar": "trade_date",
}


def simulation_date() -> str:
    """The authoritative current simulation date (YYYY-MM-DD) from the active session.

    This is the hard ceiling for every data read and cannot be overridden by a caller.
    """
    try:
        with open(SESSION_META) as handle:
            date = json.load(handle).get("date")
    except FileNotFoundError as exc:
        raise RuntimeError(f"No session found at {SESSION_META}; cannot determine the simulation date.") from exc
    if not date:
        raise RuntimeError("No simulation date present in user-sessions/meta.json.")
    return str(date)


def _quote_ident(name: str) -> str:
    """Backtick-quote a table/column identifier, rejecting anything non-identifier."""
    if not all(ch.isalnum() or ch == "_" for ch in name):
        raise ValueError(f"Unsafe SQL identifier: {name!r}")
    return f"`{name}`"


def _sql_literal(value) -> str:
    """Render a Python value as a safe SQL literal (numbers raw, everything else a
    single-quoted, escaped string). Used for the small, local analysis queries here."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def run_sql(sql: str) -> list[list[str]]:
    """Execute raw SQL and return rows as lists of string cells (tab-separated output).

    Low-level escape hatch. Prefer `fetch()` so the simulation-date cap is applied
    automatically; if you call this directly you are responsible for capping dates.
    """
    proc = subprocess.run(
        ["docker", "exec", "-i", DB_CONTAINER, "mysql",
         f"-u{DB_USER}", f"-p{DB_PASS}", DB_NAME, "--batch", "--raw", "-N", "-e", sql],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"DB query failed: {proc.stderr.strip() or proc.stdout.strip()}")
    out = proc.stdout.rstrip("\n")
    return [line.split("\t") for line in out.split("\n")] if out else []


def fetch(
    table: str,
    columns: list[str] | None = None,
    *,
    where: str | None = None,
    params: dict | None = None,
    order_by: str | None = None,
    limit: int | None = None,
    as_of: str | None = None,
) -> list[dict]:
    """Fetch rows from `table`, HARD-CAPPED at the simulation date.

    The cap uses the table's registered time column (see DATE_COLUMN). `as_of` may
    request an EARLIER cutoff but is clamped to `min(as_of, simulation_date())` — it
    can never reach beyond the simulation date. Returns a list of dict rows.

    `where` is an optional extra predicate using `:name` placeholders filled from
    `params` (values are escaped); the date cap is always AND-ed on top.
    """
    sim = simulation_date()
    effective_as_of = min(as_of, sim) if as_of else sim

    cols = [_quote_ident(c) for c in columns] if columns else None
    select_cols = ", ".join(cols) if cols else "*"
    column_names = columns if columns else None

    clauses: list[str] = []
    date_col = DATE_COLUMN.get(table)
    if date_col:
        clauses.append(f"{_quote_ident(date_col)} <= {_sql_literal(effective_as_of)}")

    if where:
        rendered = where
        for key, value in (params or {}).items():
            rendered = rendered.replace(f":{key}", _sql_literal(value))
        clauses.append(f"({rendered})")

    sql = f"SELECT {select_cols} FROM {_quote_ident(table)}"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    if order_by:
        sql += f" ORDER BY {order_by}"
    if limit is not None:
        sql += f" LIMIT {int(limit)}"

    rows = run_sql(sql)
    if column_names is None:
        # Resolve column order from the table so dict keys are correct for SELECT *.
        described = run_sql(f"SHOW COLUMNS FROM {_quote_ident(table)}")
        column_names = [r[0] for r in described]
    return [dict(zip(column_names, row)) for row in rows]
