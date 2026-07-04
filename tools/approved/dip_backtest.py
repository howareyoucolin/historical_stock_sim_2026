"""Reusable "Buy the Dip" backtester for StockSimulate2026.

Strategy (fully mechanical, no hindsight):
  - Universe = fundamentally strong, profitable companies.
      * When fundamentals exist (~2007+): positive TTM EPS AND market cap >= floor.
      * Before fundamentals exist: a price/longevity PROXY (established name with a
        long price history and a non-penny price) stands in for "quality" -- clearly
        a weaker gate, reported as such.
  - Dip signal: current close is between --dip-min and --dip-max below its trailing
    52-week high (default 30-50% off the high).
  - Hold up to --top-n such names, ranked by market cap (quality tilt), EQUAL-WEIGHT.
  - Monthly: contribute cash, EXIT any holding that left the dip band (recovered,
    broke down, or lost quality/delisted), then deploy cash to bring the current dip
    set toward equal weight. Idle cash is left to earn interest when no dips exist.

Look-ahead safety: the panel is an immutable historical series; every checkpoint uses
only rows dated <= that checkpoint (bisect slice). No decision ever sees a future bar.
All trades and the report go through the CLI (`npm run cli`), on the default session.

Usage:
    python3 dip_backtest.py --start 2016-01-01 --years 5 --panel <panel.json> \
        --strategy-version v1 [--top-n 20 --cap-floor 10 --dip-min 30 --dip-max 50]
"""
import argparse, json, os, sys, bisect, random, time, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from cli_shell import Shell

BOUNDARY = "2026-06-26"


# ---- panel access -----------------------------------------------------------
class Panel:
    def __init__(self, path):
        with open(path) as f:
            self.raw = json.load(f)
        # keep only codes that actually have data
        self.codes = [c for c, v in self.raw.items() if v["d"]]
        self.first = {c: self.raw[c]["d"][0] for c in self.codes}
        self.last = {c: self.raw[c]["d"][-1] for c in self.codes}

    # index of the most recent row with date <= d, or None if the stock has no such row
    def _idx(self, code, d):
        ds = self.raw[code]["d"]
        i = bisect.bisect_right(ds, d) - 1
        return i if i >= 0 else None

    # snapshot of a stock strictly as-of date d (close, eps, cap, 52wk-high, staleness)
    def asof(self, code, d, lookback=252):
        i = self._idx(code, d)
        if i is None:
            return None
        v = self.raw[code]
        close = v["c"][i]
        if close is None or close <= 0:
            return None
        lo = max(0, i - lookback + 1)
        window = [x for x in v["c"][lo:i + 1] if x is not None]
        if not window:
            return None
        high52 = max(window)
        return {
            "close": close, "eps": v["e"][i], "pe": v["p"][i], "cap": v["m"][i],
            "high52": high52, "drawdown": close / high52 - 1.0,
            "rows": i - lo + 1, "asof_date": v["d"][i],
        }


# ---- calendar helpers -------------------------------------------------------
def add_years(datestr, years):
    y, m, d = map(int, datestr.split("-"))
    try:
        return dt.date(y + years, m, d).isoformat()
    except ValueError:  # e.g. Feb 29 -> Feb 28
        return dt.date(y + years, m, 28).isoformat()


# number of whole calendar months between two YYYY-MM(-DD) strings
def months_between(a, b):
    return (int(b[:4]) - int(a[:4])) * 12 + (int(b[5:7]) - int(a[5:7]))


# ---- strategy ---------------------------------------------------------------
class DipStrategy:
    def __init__(self, panel, args):
        self.p = panel
        self.a = args
        self.cap_floor_m = args.cap_floor * 1000.0  # $B -> $M (panel cap is in $M)
        # earliest date any name in the panel reports EPS => when "fundamental" is possible
        firsts = [v["d"][i] for v in panel.raw.values()
                  for i, e in enumerate(v["e"]) if e is not None]
        self.first_fund_date = min(firsts) if firsts else "9999-99-99"

    # Whether the fundamental gate should apply at date d (per the run's --gate mode).
    def _use_fundamental(self, d):
        if self.a.gate == "fundamental":
            return True
        if self.a.gate == "proxy":
            return False
        return d >= self.first_fund_date  # auto: fundamentals once they exist market-wide

    # Decide whether a name passes the quality gate as-of the checkpoint; returns
    # (passes, gate_mode). Fundamental era requires verified profit + size (EPS-less
    # names are excluded); pre-fundamental era uses a price/longevity proxy for all.
    def quality(self, code, snap, d):
        if self._use_fundamental(d):
            ok = (snap["eps"] is not None and snap["eps"] > 0
                  and snap["cap"] is not None and snap["cap"] >= self.cap_floor_m)
            return ok, "fundamental"
        established = self.p.first[code] <= add_years(d, -self.a.proxy_years)
        return (established and snap["close"] >= self.a.proxy_min_price), "proxy"

    # Build the ranked target dip set as-of date d.
    def targets(self, d):
        cands = []
        gate_modes = set()
        for code in self.p.codes:
            if self.p.last[code] < d and self.p.last[code] < add_years(d, 0):
                pass  # delisted names still evaluated for exit elsewhere; skip as buy cand
            snap = self.p.asof(code, d)
            if snap is None or snap["rows"] < self.a.min_rows:
                continue
            # must be currently trading (fresh data within ~15 calendar days)
            if snap["asof_date"] < (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat():
                continue
            q, mode = self.quality(code, snap, d)
            if not q:
                continue
            decline = -snap["drawdown"]
            if self.a.dip_min / 100.0 <= decline <= self.a.dip_max / 100.0:
                gate_modes.add(mode)
                cands.append((code, snap))
        # rank: real market cap first (quality tilt), else longevity for proxy names
        cands.sort(key=lambda cs: (
            cs[1]["cap"] is not None, cs[1]["cap"] or 0.0, -len(self.p.raw[cs[0]]["d"])
        ), reverse=True)
        return cands[:self.a.top_n], gate_modes


# ---- execution --------------------------------------------------------------
class Runner:
    def __init__(self, sh, panel, args):
        self.sh, self.p, self.a = sh, panel, args
        self.strat = DipStrategy(panel, args)
        self.entry = {}      # code -> first buy sim date (for term-aware notes)
        self.gate_modes = set()
        self.rebalances = 0
        self.trades = 0

    def _date(self):
        return self.sh.js("date show")["date"]

    def _account(self):
        return self.sh.js("account show")["account"]

    def _cash(self):
        return float(self._account()["cash"])

    # total shares per held code, summed across FIFO lots (account.positions)
    def _holdings(self, acct=None):
        acct = acct or self._account()
        h = {}
        for code, lots in (acct.get("positions") or {}).items():
            qty = sum(l["quantity"] for l in lots)
            if qty:
                h[code] = qty
        return h

    # SHORT/LONG based on the earliest lot's real purchase date vs the sim date
    def _term(self, code, d, acct=None):
        acct = acct or self._account()
        lots = (acct.get("positions") or {}).get(code) or []
        if not lots:
            return "SHORT"
        first = min(l["purchase_date"] for l in lots)
        days = (dt.date.fromisoformat(d) - dt.date.fromisoformat(first)).days
        return "LONG" if days > 365 else "SHORT"

    # One monthly rebalance at date d, after the contribution has been deposited.
    def rebalance(self, d):
        self.rebalances += 1
        targets, modes = self.strat.targets(d)
        self.gate_modes |= modes
        target_codes = {c for c, _ in targets}
        snap_by = {c: s for c, s in targets}
        acct = self._account()
        holdings = self._holdings(acct)

        # EXITS. Two modes:
        #  band  (v1): sell any holding no longer inside the dip band (churns on recovery).
        #  hold  (v2): let winners run -- sell ONLY on a broken thesis (delisted/stale,
        #              lost the quality gate, or crashed past the hard stop). This keeps
        #              gains until they turn long-term, cutting turnover and tax drag.
        for code, qty in list(holdings.items()):
            snap = self.p.asof(code, d)
            term = self._term(code, d, acct)
            stale = snap is None or snap["asof_date"] < (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat()
            note = None
            if self.a.exit_mode == "band":
                if code in target_codes:
                    continue
                if stale:
                    note = f"Exit {code}: no longer trading as of {d} (delisted/halted); closing, term {term}."
                else:
                    dd = snap["drawdown"] * 100
                    reason = ("recovered" if dd > -self.a.dip_min else "broke below dip band" if dd < -self.a.dip_max else "left quality gate")
                    note = (f"Exit {code}: {reason} at {dd:.0f}% vs 52wk high (close {snap['close']:.2f}); "
                            f"dip thesis complete, realizing {term}-term result.")
            else:  # hold-winners
                if stale:
                    note = f"Exit {code}: no longer trading as of {d} (delisted/halted); closing, term {term}."
                elif not self.strat.quality(code, snap, d)[0]:
                    note = (f"Exit {code}: lost the quality gate (unprofitable / sub-scale) at {d}; "
                            f"thesis broken, realizing {term}-term result.")
                elif snap["drawdown"] * 100 < -self.a.stop_dd:
                    note = (f"Exit {code}: breached the {self.a.stop_dd:.0f}% hard stop at {snap['drawdown']*100:.0f}% "
                            f"below 52wk high (close {snap['close']:.2f}); cutting the loser, term {term}.")
                else:
                    continue  # quality winner still intact -> hold, let it run
            r = self.sh.cmd(f'account sell {code} all --note="{note}"')
            if "successfully sold" in r:
                self.trades += 1
                self.entry.pop(code, None)

        if not targets:
            return  # no dips: leave contributions in interest-earning cash

        # EQUAL-WEIGHT top-up. Sizing:
        #  dynamic (v1): per-name target = equity / (#current dips) -> concentrates when few dips.
        #  fixed   (v2): per-name target = equity / top_n -> caps any single entry near 1/N,
        #                deploys gradually, and leaves the rest in interest-earning cash.
        acct = self._account()
        holdings = self._holdings(acct)
        cash = float(acct["cash"])
        # equity across ALL holdings (winners included), valued at as-of close
        equity = cash
        for c, q in holdings.items():
            s = self.p.asof(c, d)
            if s:
                equity += q * s["close"]
        per_name = equity / (self.a.top_n if self.a.sizing == "fixed" else len(targets))
        min_buy = max(200.0, 0.05 * per_name)

        deficits = []
        for code, snap in targets:
            cur_val = holdings.get(code, 0) * snap["close"]
            deficit = per_name - cur_val
            if deficit >= min_buy:
                deficits.append((code, snap, deficit))
        total_def = sum(x[2] for x in deficits)
        if total_def <= 0:
            return
        scale = min(1.0, (cash * 0.999) / total_def)  # tiny buffer to avoid overspend

        for code, snap, deficit in deficits:
            amt = int(deficit * scale)
            if amt < min_buy:
                continue
            held = "add to" if holdings.get(code, 0) else "new"
            note = (f"Buy-the-dip ({held}): {code} {snap['drawdown']*100:.0f}% below 52wk high "
                    f"(close {snap['close']:.2f} vs high {snap['high52']:.2f}), "
                    + (f"TTM EPS {snap['eps']:.2f}>0, cap ${snap['cap']/1000:.0f}B, " if snap['eps'] is not None
                       else "pre-fundamentals proxy quality, ")
                    + f"equal-weight slot ~${per_name:,.0f}. Deploying cash over holding it at interest.")
            r = self.sh.cmd(f'account buy {code} --amount={amt} --note="{note}"')
            if "successfully bought" in r:
                self.trades += 1
                self.entry.setdefault(code, d)

    # Drive the full run: init, fund, walk forward with irregular hops, contribute monthly.
    def run(self, start, end):
        rng = random.Random(start)  # deterministic per window
        self.sh.cmd("account init")
        self.sh.cmd(f"date set {start}")
        d = self._date()
        # initial deposit + first monthly contribution on the first trading day
        self.sh.cmd(f'account deposit {self.a.initial} --note="Initial capital"')
        self.sh.cmd(f'account deposit {self.a.monthly} --note="Monthly contribution (first month)"')
        last_ym = d[:7]
        print(f"  start {d}  end target {end}", flush=True)
        self.rebalance(d)

        while d < end:
            hop = rng.randint(self.a.hop_min, self.a.hop_max)  # irregular check-ins
            self.sh.cmd(f"date next {hop}")
            nd = self._date()
            if nd == d:
                break  # no further trading day (data boundary)
            d = nd
            if d >= end:
                break
            if d[:7] != last_ym:  # entered a new month -> contribute (per month elapsed) + manage
                n_months = max(1, months_between(last_ym, d[:7]))  # don't drop skipped months' cash
                last_ym = d[:7]
                self.sh.cmd(f'account deposit {self.a.monthly * n_months} --note="Monthly contribution x{n_months}"')
                self.rebalance(d)
        return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--years", type=int, default=5)
    ap.add_argument("--panel", required=True)
    ap.add_argument("--session", default="default")
    ap.add_argument("--initial", type=int, default=200000)
    ap.add_argument("--monthly", type=int, default=2500)
    ap.add_argument("--top-n", dest="top_n", type=int, default=20)
    ap.add_argument("--cap-floor", dest="cap_floor", type=float, default=10.0, help="min market cap ($B)")
    ap.add_argument("--dip-min", dest="dip_min", type=float, default=30.0, help="min %% below 52wk high")
    ap.add_argument("--dip-max", dest="dip_max", type=float, default=50.0, help="max %% below 52wk high")
    ap.add_argument("--exit-mode", dest="exit_mode", choices=["band", "hold"], default="band",
                    help="band: exit when leaving dip band (v1); hold: let winners run, exit only on broken thesis (v2)")
    ap.add_argument("--stop-dd", dest="stop_dd", type=float, default=60.0,
                    help="hard-stop drawdown %% (hold mode only): sell if a name falls this far below its 52wk high")
    ap.add_argument("--sizing", choices=["dynamic", "fixed"], default="dynamic",
                    help="dynamic: per-name = equity/#dips (v1); fixed: per-name = equity/top_n (v2)")
    ap.add_argument("--hop-min", dest="hop_min", type=int, default=15, help="min trading days per time-skip")
    ap.add_argument("--hop-max", dest="hop_max", type=int, default=30, help="max trading days per time-skip")
    ap.add_argument("--lookback", type=int, default=252)
    ap.add_argument("--min-rows", dest="min_rows", type=int, default=200)
    ap.add_argument("--gate", choices=["auto", "fundamental", "proxy"], default="auto",
                    help="quality gate: fundamental (EPS+cap), proxy (price/longevity), or auto by era")
    ap.add_argument("--proxy-years", dest="proxy_years", type=int, default=1)
    ap.add_argument("--proxy-min-price", dest="proxy_min_price", type=float, default=5.0)
    ap.add_argument("--strategy-version", dest="strategy_version", default="v1")
    ap.add_argument("--out", default=None, help="path to write report.json copy")
    ap.add_argument("--ledger", default=os.path.join(os.path.dirname(__file__), "dip_ledger.jsonl"))
    args = ap.parse_args()

    end = add_years(args.start, args.years)
    panel = Panel(args.panel)
    print(f"Panel: {len(panel.codes)} codes. Window {args.start} -> {end} (session={args.session})")

    sh = Shell(session=args.session)
    runner = Runner(sh, panel, args)
    t0 = time.time()
    end_date = runner.run(args.start, end)

    modes = ",".join(sorted(runner.gate_modes)) or "none"
    exit_desc = ("exit when a name leaves the dip band (recovery/breakdown)" if args.exit_mode == "band"
                 else f"hold winners; exit only on broken thesis (lost quality gate, delisted, or past a {args.stop_dd:.0f}% hard stop)")
    size_desc = ("equity/#current-dips" if args.sizing == "dynamic" else f"equity/{args.top_n} fixed slots")
    summary = (f"Buy-the-Dip {args.dip_min:.0f}-{args.dip_max:.0f}% below 52wk high; profitable, "
               f"cap>=${args.cap_floor:.0f}B quality names ({modes} gate); equal-weight ({size_desc}), top {args.top_n}; "
               f"monthly contributions; {exit_desc}.")
    obj = "Maximize risk-adjusted, after-tax return of a mechanical buy-the-dip on quality names"
    build = (f'report build --json --strategy="Buy-the-Dip (Quality, 30-50% off high)" '
             f'--strategy-version={args.strategy_version} '
             f'--strategy-summary="{summary}" '
             f'--objective="{obj}" '
             f'--objective-metric="Annualized return and edge vs equal-weight S&P 500, drawdown-aware" '
             f'--objective-constraint="Only names 30-50% below 52wk high" '
             f'--objective-constraint="Profitable/quality gate ({modes})" '
             f'--objective-constraint="Equal-weight, top {args.top_n}, monthly rebalance" '
             f'--market-regime="rolling 5y {args.start[:4]}-{end[:4]}" '
             f'--note="Mechanical; look-ahead-free walk-forward; CLI-executed. Gate mode(s): {modes}."')
    rep = sh.js(build)
    sh.close()

    sim = rep.get("simulation", {})
    bench = rep.get("benchmark", {})
    pf = rep.get("portfolio", {})
    ann = sim.get("annualizedReturnPct")
    bann = bench.get("annualizedReturnPct")
    edge = (ann - bann) if (ann is not None and bann is not None) else None
    row = {
        "start": args.start, "end": end_date, "years": args.years,
        "strategy": "Buy-the-Dip (Quality, 30-50% off high)", "version": args.strategy_version,
        "gate": modes, "topN": args.top_n, "capFloorB": args.cap_floor,
        "exitMode": args.exit_mode, "sizing": args.sizing, "stopDd": args.stop_dd,
        "dipBand": f"{args.dip_min:.0f}-{args.dip_max:.0f}",
        "endingValue": sim.get("endingValue"), "totalReturnPct": sim.get("totalReturnPct"),
        "annualizedReturnPct": ann, "benchmarkAnnualizedPct": bann, "edgeAnnualizedPct": edge,
        "maxDrawdownPct": pf.get("maxDrawdownPct"), "rebalances": runner.rebalances,
        "trades": runner.trades, "secs": round(time.time() - t0, 1),
    }
    with open(args.ledger, "a") as f:
        f.write(json.dumps(row) + "\n")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rep, f, indent=1)
    print("RESULT " + json.dumps(row))


if __name__ == "__main__":
    main()
