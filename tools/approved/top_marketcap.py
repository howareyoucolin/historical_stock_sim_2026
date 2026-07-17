"""top_marketcap — rank stocks by market cap as of the simulation date.

Date-safe: market caps are read through `db.fetch` (capped at the simulation date), and
each stock is valued using its most recent quarterly market cap on or before that date,
so there is no look-ahead. Optionally filter to a sector.

Usage:
    python3 tools/approved/top_marketcap.py --limit 3
    python3 tools/approved/top_marketcap.py --sector "Information Technology" --limit 3
    python3 tools/approved/top_marketcap.py --sector tech --limit 5 --json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "approved"))
import db  # noqa: E402


def top_by_marketcap(sector: str | None = None, limit: int = 10, as_of: str | None = None) -> list[dict]:
    """Return the largest stocks by most-recent quarterly market cap as of the sim date.

    Each entry: {symbol, sector, industry, marketCap, asOfQuarter}. `sector` is a
    case-insensitive substring filter (e.g. "tech" matches "Information Technology").
    """
    # Date-capped: only quarters on or before the simulation date are visible.
    caps = db.fetch("stock_quarterly_market_cap", ["stock_id", "fiscal_quarter", "market_cap"], as_of=as_of)

    # Keep each stock's most recent priced quarter.
    latest: dict[str, dict] = {}
    for row in caps:
        if row["market_cap"] in (None, "", "NULL"):
            continue
        sid = row["stock_id"]
        if sid not in latest or row["fiscal_quarter"] > latest[sid]["fiscal_quarter"]:
            latest[sid] = row

    # Join static stock metadata (symbol/sector/industry) — no date cap needed.
    stocks = {r["id"]: r for r in db.fetch("stocks", ["id", "symbol", "sector", "industry"])}

    rows = []
    needle = sector.lower() if sector else None
    for sid, cap in latest.items():
        meta = stocks.get(sid)
        if meta is None:
            continue
        if needle and needle not in (meta["sector"] or "").lower():
            continue
        rows.append({
            "symbol": meta["symbol"],
            "sector": meta["sector"],
            "industry": meta["industry"],
            "marketCap": float(cap["market_cap"]),
            "asOfQuarter": cap["fiscal_quarter"],
        })

    rows.sort(key=lambda r: r["marketCap"], reverse=True)
    return rows[: max(0, limit)]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Rank stocks by market cap as of the simulation date.")
    parser.add_argument("--sector", default=None, help="Case-insensitive sector substring filter (e.g. 'Information Technology').")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--as-of", default=None, help="Earlier cutoff date (clamped to the sim date).")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    rows = top_by_marketcap(sector=args.sector, limit=args.limit, as_of=args.as_of)

    if args.json:
        print(json.dumps({"simulationDate": db.simulation_date(), "sector": args.sector, "rows": rows}, default=str))
    else:
        print(f"Top {len(rows)} by market cap as of {db.simulation_date()}" + (f" — sector ~ '{args.sector}'" if args.sector else ""))
        for i, r in enumerate(rows, 1):
            print(f"  {i}. {r['symbol']:6} {r['sector']:<24} mktcap={r['marketCap']:,.0f}  (q {r['asOfQuarter']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
