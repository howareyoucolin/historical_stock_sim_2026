"""sp500_membership_changes — point-in-time S&P 500 membership and join/leave signal.

Drives the "buy names that newly joined the S&P 500, sell names that dropped out"
strategy. The CLI exposes no index-membership data, so this tool reads the
`stock_index_membership` table (yearly year-end snapshots) and reports, AS OF the
current simulation date:

  * the latest membership snapshot visible now (most recent snapshot on/before today),
  * the previous snapshot, and
  * the diff between them: `joined` (in latest, not previous) and `left`
    (in previous, not latest).

DATE SAFETY (no hindsight)
--------------------------
`stock_index_membership` is NOT registered in `db.DATE_COLUMN`, so `db.fetch` does
not auto-cap it. This tool therefore enforces the cap itself: it only ever reads
snapshots whose `snapshot_date <= min(as_of, simulation_date())`. Snapshots are dated
at YEAR-END (e.g. the 2021 list is dated 2021-12-20), so on 2021-02-05 the latest
visible snapshot is 2020's — the 2021 list lies in the future and is never read.
The cap value is derived from `db.simulation_date()` (the authoritative session date)
and can only be moved EARLIER by `--as-of`, never later.

Membership tickers are dotted (BRK.B, BF.B); the tradeable universe (`stocks`) uses
dashes (BRK-B, BF-B). Symbols are normalized dot->dash before matching, and each
name carries a `tradeable` flag so the caller only buys names the CLI can price.

Usage:
    python3 tools/approved/sp500_membership_changes.py            # latest diff (text)
    python3 tools/approved/sp500_membership_changes.py --json     # latest diff (JSON)
    python3 tools/approved/sp500_membership_changes.py --members  # include full current list
    python3 tools/approved/sp500_membership_changes.py --as-of 2019-06-01 --json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "approved"))
import db  # noqa: E402

INDEX_CODE = "SP500"


def _normalize(symbol: str) -> str:
    """Membership uses dotted class tickers (BRK.B); the tradeable universe uses
    dashes (BRK-B). Normalize to the tradeable convention for matching/output."""
    return symbol.replace(".", "-")


def membership_changes(as_of: str | None = None, include_members: bool = False) -> dict:
    """Return the S&P 500 membership diff between the two most recent snapshots that
    are visible as of the simulation date (or an earlier `as_of`).

    All reads are hard-capped at `min(as_of, simulation_date())` via an explicit
    `snapshot_date` bound (this table has no auto-cap in db.py)."""
    sim = db.simulation_date()
    cap = min(as_of, sim) if as_of else sim

    # Date-capped read: only year-end snapshots dated on or before the cap are visible.
    rows = db.fetch(
        "stock_index_membership",
        ["symbol", "snapshot_year", "snapshot_date"],
        where="index_code = :idx AND snapshot_date IS NOT NULL AND snapshot_date <= :cap",
        params={"idx": INDEX_CODE, "cap": cap},
    )

    # Group symbols by snapshot (keyed by its year-end date), tracking each year.
    snapshots: dict[str, dict] = {}
    for r in rows:
        key = r["snapshot_date"]
        snap = snapshots.setdefault(key, {"date": key, "year": int(r["snapshot_year"]), "symbols": set()})
        snap["symbols"].add(_normalize(r["symbol"]))

    ordered = sorted(snapshots.values(), key=lambda s: s["date"])
    latest = ordered[-1] if ordered else None
    previous = ordered[-2] if len(ordered) >= 2 else None

    # Tradeable universe (dashed symbols) — static metadata, no date cap needed.
    stocks = {s["symbol"]: s for s in db.fetch("stocks", ["symbol", "sector", "industry"])}

    def decorate(symbols: set[str]) -> list[dict]:
        out = []
        for sym in sorted(symbols):
            meta = stocks.get(sym)
            out.append({
                "symbol": sym,
                "sector": meta["sector"] if meta else None,
                "tradeable": meta is not None,
            })
        return out

    latest_syms = latest["symbols"] if latest else set()
    prev_syms = previous["symbols"] if previous else set()
    joined = latest_syms - prev_syms if previous else set()
    left = prev_syms - latest_syms if previous else set()

    result = {
        "simulationDate": sim,
        "capDate": cap,
        "latestSnapshot": {"year": latest["year"], "date": latest["date"], "memberCount": len(latest_syms)} if latest else None,
        "previousSnapshot": {"year": previous["year"], "date": previous["date"], "memberCount": len(prev_syms)} if previous else None,
        "joined": decorate(joined),
        "left": decorate(left),
    }
    if include_members and latest:
        result["members"] = decorate(latest_syms)
    return result


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Point-in-time S&P 500 membership join/leave signal, capped at the sim date.")
    parser.add_argument("--as-of", default=None, help="Earlier cutoff date (clamped to the sim date).")
    parser.add_argument("--members", action="store_true", help="Include the full current member list.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    res = membership_changes(as_of=args.as_of, include_members=args.members)

    if args.json:
        print(json.dumps(res, default=str))
        return 0

    latest = res["latestSnapshot"]
    prev = res["previousSnapshot"]
    print(f"S&P 500 membership as of {res['simulationDate']} (cap {res['capDate']})")
    if latest:
        print(f"  latest snapshot: {latest['year']} ({latest['date']}), {latest['memberCount']} members")
    if prev:
        print(f"  prev snapshot:   {prev['year']} ({prev['date']}), {prev['memberCount']} members")
    else:
        print("  prev snapshot:   (none visible yet — no diff)")

    def show(label: str, items: list[dict]) -> None:
        tradeable = [i for i in items if i["tradeable"]]
        print(f"  {label} ({len(items)}, {len(tradeable)} tradeable):")
        for i in items:
            flag = "" if i["tradeable"] else "  [NOT TRADEABLE]"
            print(f"    {i['symbol']:8} {i['sector'] or '-'}{flag}")

    show("JOINED", res["joined"])
    show("LEFT", res["left"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
