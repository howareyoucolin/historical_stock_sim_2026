"""Reusable cap-weighted Top-N mega-cap "index fund" backtester for StockSimulate2026.

Strategy (fully mechanical, no hindsight):
  - Each month, rank the universe by market cap (as-of the sim date) and hold the top N.
  - Weight each holding PROPORTIONALLY to its market cap (cap-weighted, like a real
    cap-weighted index) -- the biggest company gets the biggest slice.
  - Drop a name as soon as it falls out of the top N (sell all); buy the new entrant.
  - Low turnover: cap weights self-adjust as prices move, so we only trade on membership
    changes and to deploy the monthly contribution toward the current cap weights. We do
    NOT trim winners (that is exactly how a cap-weighted index lets leaders run).

Pre-2007 note: the data has no shares-outstanding/market-cap before ~2006-10, so for that
era the tool falls back to a clearly-flagged PRICE proxy (rank the top N by price, weight
them EQUALLY). Such windows are not a true cap-weighted index and are reported as proxy.

Look-ahead safety: the panel is immutable history; every checkpoint uses only rows dated
<= that checkpoint. All trades + the report go through the CLI on the default session.

Usage:
    python3 index_topn.py --start 2016-01-04 --years 5 --panel <panel.json> \
        --session default --top-n 10 --strategy-version idx-v1
"""
import argparse, json, os, sys, time, random, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from cli_shell import Shell
from dip_backtest import Panel, add_years, months_between


class TopIndexRunner:
    def __init__(self, sh, panel, args):
        self.sh, self.p, self.a = sh, panel, args
        self.rebalances = 0
        self.trades = 0
        self.modes = set()
        # earliest date any name reports a market cap => when true cap-weighting is possible
        firsts = [v["d"][i] for v in panel.raw.values()
                  for i, m in enumerate(v["m"]) if m is not None]
        self.first_cap_date = min(firsts) if firsts else "9999-99-99"

    def _date(self):
        return self.sh.js("date show")["date"]

    def _account(self):
        return self.sh.js("account show")["account"]

    def _holdings(self, acct):
        h = {}
        for code, lots in (acct.get("positions") or {}).items():
            qty = sum(l["quantity"] for l in lots)
            if qty:
                h[code] = qty
        return h

    # Rank the universe as-of date d and return [(code, snap, weight)] for the top N.
    # cap era: weight = cap / sum(top-N caps). proxy era: rank by price, equal weight.
    def top_n(self, d):
        cap_era = d >= self.first_cap_date if self.a.gate != "proxy" else False
        rows = []
        cutoff = (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat()
        for code in self.p.codes:
            snap = self.p.asof(code, d)
            if snap is None or snap["asof_date"] < cutoff:
                continue  # not currently trading
            if cap_era:
                if snap["cap"] is None or snap["cap"] <= 0:
                    continue
                rank = snap["cap"]
            else:
                # proxy: established, non-penny name ranked by price level
                if self.p.first[code] > add_years(d, -self.a.proxy_years) or snap["close"] < self.a.proxy_min_price:
                    continue
                rank = snap["close"]
            rows.append((code, snap, rank))
        rows.sort(key=lambda r: r[2], reverse=True)
        top = rows[:self.a.top_n]
        if cap_era:
            self.modes.add("cap-weighted")
            tot = sum(r[2] for r in top) or 1.0
            return [(c, s, r / tot) for c, s, r in top]
        else:
            self.modes.add("price-proxy-equal")
            w = 1.0 / len(top) if top else 0
            return [(c, s, w) for c, s, r in top]

    # One monthly rebalance at date d (after the contribution has been deposited).
    def rebalance(self, d):
        self.rebalances += 1
        targets = self.top_n(d)
        if not targets:
            return
        tgt_codes = {c for c, _, _ in targets}
        acct = self._account()
        holdings = self._holdings(acct)

        # DROP-OUTS: sell any holding no longer in the top N
        for code, qty in list(holdings.items()):
            if code in tgt_codes:
                continue
            snap = self.p.asof(code, d)
            px = f"{snap['close']:.2f}" if snap else "n/a"
            note = (f"Drop {code}: no longer in the top {self.a.top_n} by market cap as of {d} "
                    f"(close {px}); index membership lost, selling to fund the current leaders.")
            r = self.sh.cmd(f'account sell {code} all --note="{note}"')
            if "successfully sold" in r:
                self.trades += 1

        # DEPLOY toward cap weights: buy underweights (incl. new entrants). No trimming.
        acct = self._account()
        holdings = self._holdings(acct)
        cash = float(acct["cash"])
        equity = cash
        for c, q in holdings.items():
            s = self.p.asof(c, d)
            if s:
                equity += q * s["close"]

        deficits = []
        for code, snap, wt in targets:
            target_val = wt * equity
            cur_val = holdings.get(code, 0) * snap["close"]
            deficit = target_val - cur_val
            if deficit > max(200.0, 0.002 * equity):
                deficits.append((code, snap, wt, deficit))
        total_def = sum(x[3] for x in deficits)
        if total_def <= 0:
            return
        scale = min(1.0, (cash * 0.999) / total_def)

        for code, snap, wt, deficit in deficits:
            amt = int(deficit * scale)
            if amt < 200:
                continue
            held = "add to" if holdings.get(code, 0) else "new entrant"
            capnote = (f"cap ${snap['cap']/1000:.0f}B" if snap["cap"] is not None else "price proxy")
            note = (f"Index buy ({held}): {code} at {snap['close']:.2f}, {capnote}, "
                    f"target weight {wt*100:.1f}% of a top-{self.a.top_n} cap-weighted book.")
            r = self.sh.cmd(f'account buy {code} --amount={amt} --note="{note}"')
            if "successfully bought" in r:
                self.trades += 1

    def run(self, start, end):
        rng = random.Random(start)
        self.sh.cmd("account init")
        self.sh.cmd(f"date set {start}")
        d = self._date()
        self.sh.cmd(f'account deposit {self.a.initial} --note="Initial capital"')
        self.sh.cmd(f'account deposit {self.a.monthly} --note="Monthly contribution (first month)"')
        last_ym = d[:7]
        print(f"  start {d}  end target {end}", flush=True)
        self.rebalance(d)
        while d < end:
            self.sh.cmd(f"date next {rng.randint(self.a.hop_min, self.a.hop_max)}")
            nd = self._date()
            if nd == d:
                break
            d = nd
            if d >= end:
                break
            if d[:7] != last_ym:
                n_months = max(1, months_between(last_ym, d[:7]))
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
    ap.add_argument("--top-n", dest="top_n", type=int, default=10)
    ap.add_argument("--gate", choices=["auto", "proxy"], default="auto",
                    help="auto: cap-weight once cap data exists, else price proxy; proxy: force price proxy")
    ap.add_argument("--proxy-years", dest="proxy_years", type=int, default=1)
    ap.add_argument("--hop-min", dest="hop_min", type=int, default=15, help="min trading days per time-skip")
    ap.add_argument("--hop-max", dest="hop_max", type=int, default=30, help="max trading days per time-skip")
    ap.add_argument("--proxy-min-price", dest="proxy_min_price", type=float, default=5.0)
    ap.add_argument("--strategy-version", dest="strategy_version", default="idx-v1")
    ap.add_argument("--out", default=None)
    ap.add_argument("--ledger", default=os.path.join(os.path.dirname(__file__), "index_ledger.jsonl"))
    args = ap.parse_args()

    end = add_years(args.start, args.years)
    panel = Panel(args.panel)
    print(f"Panel: {len(panel.codes)} codes. Window {args.start} -> {end} (session={args.session})")
    sh = Shell(session=args.session)
    runner = TopIndexRunner(sh, panel, args)
    t0 = time.time()
    end_date = runner.run(args.start, end)

    modes = ",".join(sorted(runner.modes)) or "none"
    summary = (f"Cap-weighted top-{args.top_n} mega-cap index: each month hold the {args.top_n} "
               f"largest names by market cap, weighted proportionally to market cap; drop a name "
               f"when it leaves the top {args.top_n}; deploy monthly contributions toward cap "
               f"weights; no trimming of winners ({modes}).")
    build = (f'report build --json --strategy="Cap-Weighted Top-{args.top_n} Mega-Cap Index" '
             f'--strategy-version={args.strategy_version} '
             f'--strategy-summary="{summary}" '
             f'--objective="Track a concentrated cap-weighted index of the largest US companies" '
             f'--objective-metric="Annualized return and edge vs equal-weight S&P 500, drawdown-aware" '
             f'--objective-constraint="Hold only the top {args.top_n} names by market cap" '
             f'--objective-constraint="Cap-proportional weights ({modes})" '
             f'--objective-constraint="Drop names that leave the top {args.top_n}; monthly contributions" '
             f'--market-regime="rolling 5y {args.start[:4]}-{end[:4]}" '
             f'--note="Mechanical cap-weighted top-{args.top_n}; look-ahead-free; CLI-executed. Weight mode(s): {modes}."')
    rep = sh.js(build)
    sh.close()

    sim = rep.get("simulation", {})
    bench = rep.get("benchmark", {})
    pf = rep.get("portfolio", {})
    ann, bann = sim.get("annualizedReturnPct"), bench.get("annualizedReturnPct")
    edge = (ann - bann) if (ann is not None and bann is not None) else None
    row = {
        "start": args.start, "end": end_date, "years": args.years,
        "strategy": f"Cap-Weighted Top-{args.top_n} Mega-Cap Index", "version": args.strategy_version,
        "weightMode": modes, "topN": args.top_n,
        "endingValue": sim.get("endingValue"), "totalReturnPct": sim.get("totalReturnPct"),
        "annualizedReturnPct": ann, "benchmarkAnnualizedPct": bann, "edgeAnnualizedPct": edge,
        "maxDrawdownPct": pf.get("maxDrawdownPct"), "largestPositionPct": pf.get("largestPositionPct"),
        "rebalances": runner.rebalances, "trades": runner.trades, "secs": round(time.time() - t0, 1),
    }
    with open(args.ledger, "a") as f:
        f.write(json.dumps(row) + "\n")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rep, f, indent=1)
    print("RESULT " + json.dumps(row))


if __name__ == "__main__":
    main()
