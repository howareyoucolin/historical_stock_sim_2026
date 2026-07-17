"""Supercycle thematic-rotation backtester for StockSimulate2026.

⚠️ HINDSIGHT STUDY — NOT a no-look-ahead strategy. It buys the baskets we *now know* led
each market "supercycle" (Internet → Housing/Commodities → Smartphones+Cloud → EV → AI).
Entry is lagged one year after each cycle begins and rotation is one year after the cycle
changes (modeling a *late* investor), but the *selection* still uses foreknowledge of the
winners. Treat results as a foresight-ceiling control, not an achievable edge. Reports are
labeled accordingly so the research archive is not misled.

Mechanics: within a window, hold the currently-active cycle's basket (equal-weight), deploy
monthly contributions into it, and on a rotation date sell the old basket and buy the new
one. Tickers missing from the dataset (e.g. SHOP, TSM) are dropped from their basket.

Reuses the approved CLI shell + Panel helpers. All trades go through the CLI on the session.

Usage:
    python3 supercycle_rotation.py --start 2016-07-01 --years 5 --panel <panel.json> \
        --session cycle-2016 --strategy-version cyc-2016
"""
import argparse, json, os, sys, time, random, datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "approved"))
from cli_shell import Shell
from dip_backtest import Panel, add_years, months_between

# Rotation calendar: (entry_date, cycle_name, [tickers]). A basket is held from its entry
# date until the next basket's entry date. Entry = cycle_start_year + 1 (a late investor).
# SHOP and TSM are absent from the dataset, so their baskets run without them.
SUPERCYCLES = [
    ("1996-01-01", "Internet", ["CSCO", "MSFT", "QCOM"]),
    ("2004-01-01", "Housing & Commodities", ["FCX", "CAT"]),
    ("2010-01-01", "Smartphones + Cloud", ["AAPL", "AMZN", "CRM"]),
    ("2017-01-01", "EV + Cloud + Payments", ["TSLA", "NVDA"]),        # SHOP n/a
    ("2023-01-01", "Artificial Intelligence", ["NVDA", "AVGO", "VRT", "MU"]),  # TSM n/a
]


# The cycle basket active as-of date d: the latest calendar entry with entry_date <= d
# (falling back to the first cycle for dates before any entry).
def basket_for(d):
    active = SUPERCYCLES[0]
    for entry_date, name, tickers in SUPERCYCLES:
        if entry_date <= d:
            active = (entry_date, name, tickers)
    return active[1], active[2]


class Runner:
    def __init__(self, sh, panel, args):
        self.sh, self.p, self.a = sh, panel, args
        self.rebalances = 0
        self.trades = 0
        self.cycles_held = []  # ordered unique cycle names actually held

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

    # Tickers in the active basket that are actually trading as-of d (fresh data within ~15 days).
    def _active_tradeable(self, d):
        name, tickers = basket_for(d)
        cutoff = (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat()
        live = []
        for t in tickers:
            snap = self.p.asof(t, d)
            if snap is not None and snap["asof_date"] >= cutoff:
                live.append((t, snap))
        return name, live

    # One monthly rebalance at date d (after the contribution deposit): rotate to the active
    # cycle basket and equal-weight it.
    def rebalance(self, d):
        self.rebalances += 1
        name, live = self._active_tradeable(d)
        if name not in self.cycles_held:
            self.cycles_held.append(name)
        target = {t for t, _ in live}
        snap_by = {t: s for t, s in live}
        acct = self._account()
        holdings = self._holdings(acct)

        # Sell anything not in the current basket (rotation / basket change).
        for code in list(holdings.keys()):
            if code in target:
                continue
            note = f"Rotate out {code}: no longer in the active supercycle basket ({name}) as of {d}."
            r = self.sh.cmd(f'account sell {code} all --note="{note}"')
            if "successfully sold" in r:
                self.trades += 1

        if not live:
            return

        # Equal-weight the basket; deploy available cash to underweight names.
        acct = self._account()
        holdings = self._holdings(acct)
        cash = float(acct["cash"])
        equity = cash + sum(holdings.get(t, 0) * snap_by[t]["close"] for t in target)
        per_name = equity / len(live)
        min_buy = max(200.0, 0.02 * equity)

        deficits = []
        for t, snap in live:
            cur = holdings.get(t, 0) * snap["close"]
            deficit = per_name - cur
            if deficit >= min_buy:
                deficits.append((t, snap, deficit))
        total = sum(x[2] for x in deficits)
        if total <= 0:
            return
        scale = min(1.0, (cash * 0.999) / total)
        for t, snap, deficit in deficits:
            amt = int(deficit * scale)
            if amt < min_buy:
                continue
            held = "add to" if holdings.get(t, 0) else "new"
            note = f"Supercycle {name} ({held}): {t} at {snap['close']:.2f}, equal-weight ~${per_name:,.0f} (lagged-thematic HINDSIGHT study)."
            r = self.sh.cmd(f'account buy {t} --amount={amt} --note="{note}"')
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
    ap.add_argument("--hop-min", dest="hop_min", type=int, default=15)
    ap.add_argument("--hop-max", dest="hop_max", type=int, default=30)
    ap.add_argument("--strategy-version", dest="strategy_version", default="cyc-v1")
    ap.add_argument("--out", default=None)
    ap.add_argument("--ledger", default=os.path.join(os.path.dirname(__file__), "supercycle_ledger.jsonl"))
    args = ap.parse_args()

    end = add_years(args.start, args.years)
    panel = Panel(args.panel)
    print(f"Panel: {len(panel.codes)} codes. Window {args.start} -> {end} (session={args.session})")
    sh = Shell(session=args.session)
    runner = Runner(sh, panel, args)
    t0 = time.time()
    end_date = runner.run(args.start, end)

    cycles = " -> ".join(runner.cycles_held) or "none"
    summary = (f"HINDSIGHT lagged-thematic supercycle rotation: hold the (retrospectively) leading basket "
               f"of each market supercycle, entered 1y after the cycle begins and rotated 1y after it changes; "
               f"equal-weight; monthly contributions. Cycles held this window: {cycles}. Selection uses "
               f"foreknowledge of winners — a foresight-ceiling control, not an achievable edge.")
    build = (f'report build --json --strategy="Supercycle Rotation (lagged thematic, HINDSIGHT)" '
             f'--strategy-version={args.strategy_version} '
             f'--strategy-summary="{summary}" '
             f'--objective="Measure the foresight ceiling of riding each supercycle leader a year late" '
             f'--objective-metric="Annualized return and edge vs equal-weight S&P 500" '
             f'--objective-constraint="Fixed thematic baskets entered/rotated with a 1-year lag" '
             f'--objective-constraint="HINDSIGHT control: winners chosen with foreknowledge" '
             f'--market-regime="rolling 5y {args.start[:4]}-{end[:4]}" '
             f'--note="HINDSIGHT thematic study; equal-weight; CLI-executed. Cycles: {cycles}."')
    rep = sh.js(build)
    sh.close()

    sim, bench, pf = rep.get("simulation", {}), rep.get("benchmark", {}), rep.get("portfolio", {})
    ann, bann = sim.get("annualizedReturnPct"), bench.get("annualizedReturnPct")
    edge = (ann - bann) if (ann is not None and bann is not None) else None
    row = {
        "start": args.start, "end": end_date, "years": args.years,
        "strategy": "Supercycle Rotation (HINDSIGHT)", "version": args.strategy_version,
        "cyclesHeld": runner.cycles_held,
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
