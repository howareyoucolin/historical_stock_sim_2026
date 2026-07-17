"""Trend-following market filter for StockSimulate2026 (no-look-ahead).

The dataset has no SPY/QQQ ETF, so the "market" is a proxy: an equal-weight basket of the
top-N largest names by market cap (pre-cap era: the longest-listed non-penny names). Each month
check market breadth — the fraction of a broad eligible universe trading above its own 200-day
moving average. Risk-ON (breadth >= threshold): hold the market basket equal-weight. Risk-OFF:
sell to cash (which earns money-market interest). Classic drawdown-control trend filter.

No look-ahead: SMA/breadth use only rows <= the checkpoint. Trades via the CLI. Reuses cli_shell + Panel.

Usage:
    python3 trend_filter.py --start 2016-07-01 --years 5 --panel <panel.json> \
        --session trend-2016 --top-n 20 --ma 200 --breadth 0.5
"""
import argparse, json, os, sys, time, random, bisect, statistics, datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "approved"))
from cli_shell import Shell
from dip_backtest import Panel, add_years, months_between


class TrendFilter:
    def __init__(self, panel, args):
        self.p, self.a = panel, args

    def _idx(self, code, d):
        ds = self.p.raw[code]["d"]
        i = bisect.bisect_right(ds, d) - 1
        return i if i >= 0 else None

    def _fresh(self, code, d, i):
        return self.p.raw[code]["d"][i] >= (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat()

    def close(self, code, d):
        i = self._idx(code, d)
        return self.p.raw[code]["c"][i] if i is not None else None

    def sma(self, code, d, window):
        v = self.p.raw[code]; i = self._idx(code, d)
        if i is None or i - window + 1 < 0:
            return None
        xs = [x for x in v["c"][i - window + 1: i + 1] if x is not None]
        return statistics.mean(xs) if len(xs) >= window * 0.9 else None

    # Fraction of the broad eligible universe trading above its own MA-day moving average.
    def breadth(self, d):
        above = total = 0
        for code in self.p.codes:
            i = self._idx(code, d)
            if i is None or not self._fresh(code, d, i):
                continue
            c = self.p.raw[code]["c"][i]
            if c is None or c < self.a.min_price:
                continue
            m = self.sma(code, d, self.a.ma)
            if m is None:
                continue
            total += 1
            if c > m:
                above += 1
        return (above / total) if total >= 20 else None

    # The market basket to hold when risk-on: top-N by cap (else longest-listed non-penny names).
    def basket(self, d):
        cutoff = (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat()
        rows = []
        for code in self.p.codes:
            i = self._idx(code, d)
            if i is None or self.p.raw[code]["d"][i] < cutoff:
                continue
            c = self.p.raw[code]["c"][i]
            if c is None or c < self.a.min_price:
                continue
            cap = self.p.raw[code]["m"][i]
            rank = cap if cap is not None else 0.0
            hist = len(self.p.raw[code]["d"])  # tiebreak / pre-cap proxy = longevity
            rows.append((code, c, rank, hist))
        rows.sort(key=lambda r: (r[2], r[3]), reverse=True)
        return [(code, c) for code, c, _, _ in rows[: self.a.top_n]]


class Runner:
    def __init__(self, sh, panel, args):
        self.sh, self.p, self.a = sh, panel, args
        self.tf = TrendFilter(panel, args)
        self.rebalances = 0
        self.trades = 0
        self.risk_on_months = 0
        self.cash_months = 0

    def _date(self):
        return self.sh.js("date show")["date"]

    # Fast read: cash + per-code share counts (no per-holding valuation; we value from the panel).
    def _state(self):
        return self.sh.js("account cash")

    def _holdings(self, state):
        return {c: q for c, q in (state.get("positions") or {}).items() if q}

    def rebalance(self, d):
        self.rebalances += 1
        br = self.tf.breadth(d)
        risk_on = br is not None and br >= self.a.breadth
        state = self._state(); holdings = self._holdings(state)

        if not risk_on:
            self.cash_months += 1
            for code in list(holdings.keys()):
                r = self.sh.cmd(f'account sell {code} all --note="Trend filter RISK-OFF at {d} (breadth {br:.0%} < {self.a.breadth:.0%}, below {self.a.ma}d MA); to cash."')
                if "successfully sold" in r:
                    self.trades += 1
            return

        self.risk_on_months += 1
        targets = self.tf.basket(d)
        tgt = {c for c, _ in targets}; px = {c: p for c, p in targets}
        for code in list(holdings.keys()):
            if code in tgt:
                continue
            r = self.sh.cmd(f'account sell {code} all --note="Trend filter: {code} left the market basket at {d}."')
            if "successfully sold" in r:
                self.trades += 1
        state = self._state(); holdings = self._holdings(state); cash = float(state["cash"])
        equity = cash + sum(holdings.get(c, 0) * (px[c] or 0) for c in tgt)
        per = equity / len(targets)
        min_buy = max(200.0, 0.01 * equity)
        deficits = [(c, per - holdings.get(c, 0) * (px[c] or 0)) for c, _ in targets]
        deficits = [(c, x) for c, x in deficits if x >= min_buy and px[c]]
        total = sum(x for _, x in deficits)
        if total <= 0:
            return
        scale = min(1.0, (cash * 0.999) / total)
        for code, deficit in deficits:
            amt = int(deficit * scale)
            if amt < min_buy:
                continue
            r = self.sh.cmd(f'account buy {code} --amount={amt} --note="Trend filter RISK-ON at {d} (breadth {br:.0%}); market basket equal-weight ~${per:,.0f}."')
            if "successfully bought" in r:
                self.trades += 1

    def run(self, start, end):
        rng = random.Random(start + "trend")
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
                n = max(1, months_between(last_ym, d[:7]))
                last_ym = d[:7]
                self.sh.cmd(f'account deposit {self.a.monthly * n} --note="Monthly contribution x{n}"')
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
    ap.add_argument("--ma", type=int, default=200)
    ap.add_argument("--breadth", type=float, default=0.5, help="risk-on when this fraction of the universe is above its MA")
    ap.add_argument("--min-price", dest="min_price", type=float, default=5.0)
    ap.add_argument("--hop-min", dest="hop_min", type=int, default=15)
    ap.add_argument("--hop-max", dest="hop_max", type=int, default=30)
    ap.add_argument("--strategy-version", dest="strategy_version", default="trend-v1")
    ap.add_argument("--out", default=None)
    ap.add_argument("--ledger", default=os.path.join(os.path.dirname(__file__), "trend_filter_ledger.jsonl"))
    args = ap.parse_args()

    end = add_years(args.start, args.years)
    panel = Panel(args.panel)
    print(f"Panel: {len(panel.codes)} codes. Trend filter | Window {args.start} -> {end} (session={args.session})")
    sh = Shell(session=args.session)
    runner = Runner(sh, panel, args)
    t0 = time.time()
    end_date = runner.run(args.start, end)

    total_m = runner.risk_on_months + runner.cash_months or 1
    summary = (f"Trend-following market filter: hold an equal-weight top-{args.top_n} large-cap market basket when "
               f"market breadth (fraction of the universe above its {args.ma}-day MA) >= {args.breadth:.0%}, else go to "
               f"cash. No SPY/QQQ in data, so the market is a large-cap basket proxy. Risk-on {runner.risk_on_months}/"
               f"{total_m} months. Drawdown-control study.")
    build = (f'report build --json --strategy="Trend-Following Filter (200d breadth)" '
             f'--strategy-version={args.strategy_version} '
             f'--strategy-summary="{summary}" '
             f'--objective="Test a 200-day trend filter for drawdown control" '
             f'--objective-metric="Annualized return and max drawdown vs equal-weight S&P 500" '
             f'--objective-constraint="Hold market-basket proxy above the MA breadth threshold, else cash" '
             f'--objective-constraint="No look-ahead; SMA/breadth from data as-of date" '
             f'--market-regime="rolling {args.years}y {args.start[:4]}-{end[:4]}" '
             f'--note="Trend filter; market=large-cap basket proxy (no SPY in data); risk-on {runner.risk_on_months}/{total_m} mo."')
    rep = sh.js(build)
    sh.close()
    if rep.get("error"):
        raise SystemExit(rep["error"])

    sim, bench, pf = rep.get("simulation", {}), rep.get("benchmark", {}), rep.get("portfolio", {})
    ann, bann = sim.get("annualizedReturnPct"), bench.get("annualizedReturnPct")
    if sim.get("endingValue") is None or ann is None or bann is None:
        raise SystemExit(f"report build returned incomplete metrics for session {args.session}")
    edge = (ann - bann) if (ann is not None and bann is not None) else None
    row = {
        "start": args.start, "end": end_date, "years": args.years, "strategy": "Trend-Following Filter (200d breadth)",
        "preset": "trend-filter", "version": args.strategy_version,
        "riskOnMonths": runner.risk_on_months, "cashMonths": runner.cash_months,
        "endingValue": sim.get("endingValue"), "totalReturnPct": sim.get("totalReturnPct"),
        "annualizedReturnPct": ann, "benchmarkAnnualizedPct": bann, "edgeAnnualizedPct": edge,
        "maxDrawdownPct": pf.get("maxDrawdownPct"), "largestPositionPct": pf.get("largestPositionPct"),
        "rebalances": runner.rebalances, "trades": runner.trades, "secs": round(time.time() - t0, 1),
    }
    with open(args.ledger, "a") as fh:
        fh.write(json.dumps(row) + "\n")
    if args.out:
        with open(args.out, "w") as fh:
            json.dump(rep, fh, indent=1)
    print("RESULT " + json.dumps(row))


if __name__ == "__main__":
    main()
