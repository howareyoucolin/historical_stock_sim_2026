"""price_loader — load a stock's daily price history, capped at the simulation date.

This is the canonical "Price Loader Tool" from the framework's preferred architecture
(Agent -> Price Loader -> Database). It never returns a bar dated after the current
simulation date; the cap is enforced by `db.fetch`, not by the caller.

Usage (executable):
    python3 tools/approved/database/price_loader.py AAPL
    python3 tools/approved/database/price_loader.py AAPL --as-of 2019-08-15 --limit 20 --json

Library:
    from price_loader import load_daily_prices
    bars = load_daily_prices("AAPL")           # capped at the sim date
    bars = load_daily_prices("AAPL", as_of="2019-08-15")  # earlier cutoff (still clamped)
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db  # noqa: E402  (sibling module in the same tool dir)


def resolve_stock_id(symbol: str) -> int | None:
    """Look up a symbol's numeric id from the static `stocks` table (no date cap needed)."""
    rows = db.fetch("stocks", ["id"], where="symbol = :symbol", params={"symbol": symbol.upper()}, limit=1)
    return int(rows[0]["id"]) if rows else None


def load_daily_prices(symbol: str, as_of: str | None = None) -> list[dict]:
    """Return [{trade_date, close, adj_close, volume}, ...] oldest-first for `symbol`,
    hard-capped at the simulation date (or the earlier `as_of`, whichever is smaller).
    Returns [] for an unknown symbol."""
    stock_id = resolve_stock_id(symbol)
    if stock_id is None:
        return []
    return db.fetch(
        "stock_daily_prices",
        ["trade_date", "close", "adj_close", "volume"],
        where="stock_id = :id",
        params={"id": stock_id},
        order_by="trade_date ASC",
        as_of=as_of,
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Load daily prices capped at the simulation date.")
    parser.add_argument("symbol")
    parser.add_argument("--as-of", default=None, help="Earlier cutoff date (clamped to the sim date).")
    parser.add_argument("--limit", type=int, default=None, help="Only show the last N bars.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of a table.")
    args = parser.parse_args(argv)

    bars = load_daily_prices(args.symbol, as_of=args.as_of)
    if args.limit:
        bars = bars[-args.limit:]

    if args.json:
        print(json.dumps({"symbol": args.symbol.upper(), "simulationDate": db.simulation_date(),
                          "count": len(bars), "bars": bars}, default=str))
    else:
        print(f"{args.symbol.upper()} — {len(bars)} bars through sim date {db.simulation_date()}")
        for bar in bars:
            print(f"  {bar['trade_date']}  close={bar['close']}  vol={bar['volume']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
