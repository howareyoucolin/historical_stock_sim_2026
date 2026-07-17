"""Build a local monthly-metrics panel from stock_monthly_metrics, once, for reuse.

Why a panel: the CLI only exposes price/EPS/PE/cap history (build_price_panel.py),
but the scoring scripts need the FULL stock_monthly_metrics feature set (returns,
momentum, 52w-high/200d-MA distance, realized vol, liquidity, dividends, margins,
FCF, revenue growth, forward EPS/PE/PEG, market cap). Those live only in the DB
table, so we export them once here and the scoring runner slices `month_end <= d`
to walk forward with no look-ahead -- the same immutable-panel discipline the
approved price-panel backtesters use.

Look-ahead safety:
  - The read goes through the approved db.fetch(), which HARD-CAPS every row at the
    simulation date. We park that ceiling at the data boundary (2026-06-26) so the
    panel covers all four backtest windows, exactly like build_price_panel.py pulls
    the whole history to the boundary.
  - The panel is then an immutable historical series; scoring_lab.py only ever reads
    rows dated <= the current checkpoint (bisect), and additionally applies a
    reporting lag to the quarter-derived fundamentals (see scoring_lab.py), because
    the importer attaches a fiscal quarter on its quarter-END date with no filing lag.

Output: one JSON file
    {"meta": {...}, "stocks": {SYMBOL: {"me": [month_end...], "<col>": [values...]}}}

Usage:
    python3 build_metrics_panel.py --boundary 2026-06-26 --out metrics_panel.json
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "approved"))
import db  # approved date-safe DB layer

# db.py reads its simulation-date ceiling from this legacy top-level file. The app itself
# uses per-session folders + active-session.json, so writing this only moves db.fetch's cap.
TOP_META = os.path.join(db.SIM_ROOT, "user-sessions", "meta.json")

# Columns pulled per monthly row. month_end is stored separately as "me"; everything else
# is kept verbatim so the runner can recompute a lag-honest fundamentals view itself.
METRIC_COLS = [
    "close", "adj_close",
    "return_1m_pct", "return_3m_pct", "return_6m_pct", "return_12m_pct", "momentum_12_1_pct",
    "high_52w", "from_52w_high_pct", "ma_200d", "from_200d_ma_pct", "realized_vol_3m",
    "avg_daily_volume_3m", "avg_daily_dollar_volume_3m", "trading_days_3m",
    "dividend_ttm", "dividend_yield_ttm_pct",
    "fundamentals_quarter", "eps_ttm", "eps_growth_pct", "forward_eps", "pe", "forward_pe", "peg",
    "revenue_ttm", "revenue_growth_pct", "operating_income_ttm", "operating_income_growth_pct",
    "free_cash_flow_ttm", "free_cash_flow_growth_pct", "operating_margin_pct", "free_cash_flow_margin_pct",
    "market_cap_quarter", "shares_outstanding", "market_cap",
]
DATE_COLS = {"fundamentals_quarter", "market_cap_quarter"}  # kept as strings, not floats


# The mysql --batch reader returns NULL as the literal string "NULL"; normalize cells to
# None / float / date-string so the panel is clean, typed JSON.
def _coerce(col, value):
    if value is None or value == "NULL" or value == "":
        return None
    if col in DATE_COLS:
        return value
    try:
        return float(value)
    except (TypeError, ValueError):
        return value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boundary", default="2026-06-26", help="data boundary; db.fetch is capped here")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "unapproved", "metrics_panel.json"))
    args = ap.parse_args()

    # Park db.fetch's simulation-date ceiling at the boundary so we can export full history.
    os.makedirs(os.path.dirname(TOP_META), exist_ok=True)
    with open(TOP_META, "w") as fh:
        json.dump({"date": args.boundary}, fh)

    id_to_symbol = {str(r["id"]): r["symbol"] for r in db.fetch("stocks", ["id", "symbol"])}
    print(f"{len(id_to_symbol)} stocks. Pulling stock_monthly_metrics <= {args.boundary} ...", flush=True)

    rows = db.fetch(
        "stock_monthly_metrics",
        ["stock_id", "month_end"] + METRIC_COLS,
        order_by="stock_id ASC, month_end ASC",
    )
    print(f"{len(rows)} monthly rows. Grouping by symbol ...", flush=True)

    stocks = {}
    for r in rows:
        symbol = id_to_symbol.get(str(r["stock_id"]))
        if symbol is None:
            continue
        s = stocks.setdefault(symbol, {"me": []})
        s["me"].append(r["month_end"])
        for col in METRIC_COLS:
            s.setdefault(col, []).append(_coerce(col, r.get(col)))

    panel = {
        "meta": {
            "boundary": args.boundary,
            "metric_cols": METRIC_COLS,
            "note": "month_end series per symbol; runner reads only rows <= checkpoint and "
                    "lags quarter-derived fundamentals to filing availability.",
        },
        "stocks": stocks,
    }
    with open(args.out, "w") as fh:
        json.dump(panel, fh)
    non_empty = sum(1 for v in stocks.values() if v["me"])
    print(f"Done: {len(stocks)} symbols ({non_empty} non-empty) -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
