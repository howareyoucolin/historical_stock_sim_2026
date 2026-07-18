"""Build the SPY benchmark files the V2 scoring lab compares against.

Given a dividend-adjusted SPY monthly price series, this emits, using the SAME cash-flow
timing and XIRR as the scoring lab (it literally reuses scoring_lab / scoring_lab_v2 — no
re-implementation, no estimation, no hardcoded numbers):

  1. --out-prices  spy_benchmark.json   {"benchmark":"SPY","me":[...],"price":[...]}
     the price-series file the runner already consumes:
       scoring_lab_v2.py --benchmark spy --benchmark-file spy_benchmark.json
     From it the runner computes SPY XIRR for every one of the ~179 monthly-step rolling
     windows in-process, so the per-window strat/SPY ratio stays exact.

  2. --out-xirr    spy_xirr_by_year.json {"2002": 12.3842, "2003": 15.8321, ...}
     the compact year-keyed summary requested for reporting/lookup: for each start YEAR,
     the SPY XIRR of the 5-year rolling window beginning at that year's first month-end.
     (This is annual granularity — a summary, not what feeds the 179 monthly windows.)

Funding + timing come straight from the lab: $200,000 initial + $2,500 monthly, deposits on
each month-end rebalance date, ending value at the last month-end, XIRR (scoring_lab.xirr).

SPY INPUT (--spy-file) is required for real output and must be dividend-adjusted (total return):
    {"me": ["2001-01-31", ...], "adj_close": [<level>, ...]}   # or "price" instead of adj_close
No SPY data ships with this project. Until you provide it, use --source proxy to emit the SAME
files from the in-panel cap-weight universe proxy (real, computed, but NOT SPY — stamped
benchmark="CAPW_UNIV", the same generation as an in-process `--benchmark capw` run; the README
and skill make its interim-proxy status explicit).

Usage:
    # real SPY, once you have the data:
    python3 build_spy_benchmark.py --spy-file spy_source.json \
        --out-prices tools/unapproved/spy_benchmark.json \
        --out-xirr   tools/unapproved/spy_xirr_by_year.json

    # format demo / interim stopgap from the cap-weight proxy (clearly NOT SPY):
    python3 build_spy_benchmark.py --source proxy \
        --out-prices tools/unapproved/spy_benchmark.proxy.json \
        --out-xirr   tools/unapproved/spy_xirr_by_year.proxy.json
"""
import argparse, bisect, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # scoring_lab + scoring_lab_v2 (same tools dir)
import scoring_lab as v1
import scoring_lab_v2 as v2

# Earliest window start the tool will emit (data supports ~2002; panel begins 2001-01).
DEFAULT_START_FLOOR = "2002-01-01"

# Canonical, tracked home for the shippable benchmark files the V2 skill references.
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
DEFAULT_OUT_PRICES = os.path.join(DATA_DIR, "spy_benchmark.json")
DEFAULT_OUT_XIRR = os.path.join(DATA_DIR, "spy_xirr_by_year.json")


# Build a benchmark NAV aligned to `cal` from a dividend-adjusted SPY series (as-of lookup),
# reusing the same shape scoring_lab_v2.build_file_benchmark uses for the runner.
def spy_nav_from_file(path, cal):
    with open(path) as fh:
        raw = json.load(fh)
    me = raw["me"]
    px = raw.get("adj_close") or raw.get("price")
    if not px:
        raise SystemExit(f"{path}: expected an 'adj_close' (or 'price') array")
    nav = {}
    for d in cal:
        i = bisect.bisect_right(me, d) - 1
        if 0 <= i < len(px) and px[i]:
            nav[d] = float(px[i])
    return nav, "SPY"


# One rolling 5-year window per START YEAR: start = that year's first month-end in the calendar,
# end = last month-end within ~5 years. Returns {year: (start, end, cal_slice)} for complete windows.
def yearly_windows(cal, years, floor):
    by_year = {}
    for d in cal:
        if d >= floor:
            by_year.setdefault(d[:4], d)  # first month-end seen in each year
    out = {}
    for yr, start in sorted(by_year.items()):
        end_target = v2._add_years(start, years)
        if end_target > v2.BOUNDARY:
            continue
        cal_w = [d for d in cal if start <= d <= end_target]
        if len(cal_w) >= 6:
            span_days = (v1.dt.date.fromisoformat(cal_w[-1]) - v1.dt.date.fromisoformat(cal_w[0])).days
            if span_days >= (years - 0.25) * 365:
                out[yr] = (cal_w[0], cal_w[-1], cal_w)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--panel", default=os.path.join(os.path.dirname(__file__), "..", "unapproved", "metrics_panel.json"))
    ap.add_argument("--spy-file", dest="spy_file", default=None,
                    help="dividend-adjusted SPY series {me:[],adj_close:[]}; required unless --source proxy")
    ap.add_argument("--source", choices=["spy", "proxy"], default="spy",
                    help="'spy' reads --spy-file; 'proxy' computes the cap-weight universe stand-in")
    ap.add_argument("--rolling-years", dest="rolling_years", type=int, default=v2.ROLLING_YEARS)
    ap.add_argument("--start-floor", dest="start_floor", default=DEFAULT_START_FLOOR)
    ap.add_argument("--initial", type=int, default=200000)
    ap.add_argument("--monthly", type=int, default=2500)
    ap.add_argument("--reporting-lag-days", dest="reporting_lag_days", type=int, default=60)
    ap.add_argument("--out-prices", dest="out_prices", default=DEFAULT_OUT_PRICES,
                    help="write the price-series file here (default: tools/data/spy_benchmark.json)")
    ap.add_argument("--out-xirr", dest="out_xirr", default=DEFAULT_OUT_XIRR,
                    help="write the year->XIRR JSON here (default: tools/data/spy_xirr_by_year.json)")
    args = ap.parse_args()
    os.makedirs(DATA_DIR, exist_ok=True)

    panel = v1.MetricsPanel(args.panel, args.reporting_lag_days)
    cal = panel.calendar(args.start_floor, v2.BOUNDARY)

    if args.source == "spy":
        if not args.spy_file:
            raise SystemExit(
                "No SPY data available. Provide --spy-file <dividend-adjusted SPY series>, or use "
                "--source proxy to emit the cap-weight stand-in (clearly labelled NOT SPY).")
        nav, code = spy_nav_from_file(args.spy_file, cal)
    else:
        # The shipped proxy is the SAME benchmark generation as an in-process `--benchmark capw`
        # run, so it carries the same code (CAPW_UNIV) — file-based and in-process results stay
        # directly comparable. Its "it's a proxy, not real SPY" status lives in the README/skill.
        bench = v2.build_universe_benchmark(panel, cal, "capw")
        nav, code = bench.nav, bench.code

    # year -> SPY XIRR %, using the lab's own window_gain (deposits + scoring_lab.xirr).
    windows = yearly_windows(cal, args.rolling_years, args.start_floor)
    xirr_by_year = {}
    for yr, (start, end, cal_w) in windows.items():
        g = v2.window_gain(nav, cal_w, args.initial, args.monthly)
        if g is not None:
            xirr_by_year[yr] = round(g, 4)

    print(f"Source: {code}  |  {len(cal)} month-ends  |  {len(xirr_by_year)} complete "
          f"{args.rolling_years}y windows ({min(xirr_by_year)}..{max(xirr_by_year)} starts)", flush=True)
    print(json.dumps(xirr_by_year, indent=2), flush=True)

    if args.out_xirr:
        with open(args.out_xirr, "w") as fh:
            # Include provenance so a proxy file can never be mistaken for real SPY.
            json.dump({"benchmark": code, "methodology": "monthly deposits + XIRR (scoring_lab)",
                       "rolling_years": args.rolling_years, "xirr_by_start_year": xirr_by_year}, fh, indent=2)
        print(f"Wrote year->XIRR -> {args.out_xirr}", flush=True)

    if args.out_prices:
        me_sorted = [d for d in cal if d in nav]
        with open(args.out_prices, "w") as fh:
            json.dump({"benchmark": code, "me": me_sorted, "price": [nav[d] for d in me_sorted]}, fh)
        print(f"Wrote price series ({len(me_sorted)} points) -> {args.out_prices}", flush=True)


if __name__ == "__main__":
    main()
