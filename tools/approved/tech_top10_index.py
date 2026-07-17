"""No-look-ahead top-tech monthly rebalancer for StockSimulate2026.

Strategy:
  - Universe = names whose static sector label matches Information Technology.
  - Each month, rank that tech universe by market cap as of the simulation date.
  - Hold the top N tech names only (default 10), equal-weighted.
  - Rebalance monthly: sell names that leave the top N, trim overweight winners,
    and buy underweights / new entrants back to target.

Pre-cap era note: the data has sparse market-cap coverage before ~2006/2007. In that
window the strategy falls back to a clearly-labeled price proxy: rank established,
non-penny tech names by price and still hold them equal-weighted. This preserves the
no-look-ahead rule while acknowledging the historical data gap.
"""
import argparse
import json
import math
import os
import random
import sys
import time
import datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "approved"))
from cli_shell import Shell
from dip_backtest import Panel, add_years, months_between


def resolve_end_date(start: str, years: int | None, end: str | None) -> str:
    if end:
        return end
    if years is None:
        raise ValueError("Provide either --years or --end.")
    return add_years(start, years)


class TechTopRunner:
    def __init__(self, sh, panel, sector_map, args):
        self.sh, self.p, self.a = sh, panel, args
        self.rebalances = 0
        self.trades = 0
        self.modes = set()
        token = args.sector_token.lower()
        self.tech_codes = [
            code for code in panel.codes
            if token in (sector_map.get(code) or "").lower()
        ]
        firsts = [
            series["d"][i]
            for code, series in panel.raw.items()
            if code in set(self.tech_codes)
            for i, cap in enumerate(series["m"])
            if cap is not None
        ]
        self.first_cap_date = min(firsts) if firsts else "9999-99-99"

    def _date(self):
        return self.sh.js("date show")["date"]

    def _account(self):
        return self.sh.js("account show")["account"]

    def _holdings(self, acct):
        holdings = {}
        for code, lots in (acct.get("positions") or {}).items():
            qty = sum(lot["quantity"] for lot in lots)
            if qty:
                holdings[code] = qty
        return holdings

    def targets(self, d):
        cap_era = d >= self.first_cap_date if self.a.gate != "proxy" else False
        cutoff = (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat()
        rows = []
        for code in self.tech_codes:
            snap = self.p.asof(code, d)
            if snap is None or snap["asof_date"] < cutoff:
                continue
            if cap_era:
                if snap["cap"] is None or snap["cap"] <= 0:
                    continue
                rank = snap["cap"]
            else:
                if self.p.first[code] > add_years(d, -self.a.proxy_years):
                    continue
                if snap["close"] < self.a.proxy_min_price:
                    continue
                rank = snap["close"]
            rows.append((code, snap, rank))
        rows.sort(key=lambda row: row[2], reverse=True)
        top = rows[: self.a.top_n]
        if cap_era:
            self.modes.add("market-cap")
        else:
            self.modes.add("price-proxy")
        return top

    def rebalance(self, d):
        self.rebalances += 1
        targets = self.targets(d)
        if not targets:
            return

        target_codes = {code for code, _, _ in targets}
        snap_by = {code: snap for code, snap, _ in targets}
        acct = self._account()
        holdings = self._holdings(acct)

        equity = float(acct["cash"])
        for code, qty in holdings.items():
            snap = self.p.asof(code, d)
            if snap:
                equity += qty * snap["close"]
        target_value = equity / len(targets)

        for code in list(holdings.keys()):
            if code in target_codes:
                continue
            note = (
                f"Rotate out {code}: no longer in the top {self.a.top_n} tech names as of {d}; "
                f"monthly rebalance into the current tech leaders."
            )
            result = self.sh.cmd(f'account sell {code} all --note="{note}"')
            if "successfully sold" in result:
                self.trades += 1

        acct = self._account()
        holdings = self._holdings(acct)

        for code, snap, _ in targets:
            owned = holdings.get(code, 0)
            target_qty = max(0, math.floor(target_value / snap["close"]))
            if owned <= target_qty:
                continue
            qty = owned - target_qty
            if qty <= 0:
                continue
            note = (
                f"Trim {code}: rebalance down to equal weight in the top-{self.a.top_n} tech basket "
                f"at {d} (price {snap['close']:.2f})."
            )
            result = self.sh.cmd(f'account sell {code} {qty} --note="{note}"')
            if "successfully sold" in result:
                self.trades += 1

        acct = self._account()
        holdings = self._holdings(acct)

        for code, snap, rank in targets:
            owned = holdings.get(code, 0)
            target_qty = max(0, math.floor(target_value / snap["close"]))
            if owned >= target_qty:
                continue
            qty = target_qty - owned
            if qty <= 0:
                continue
            rank_note = (
                f"cap ${snap['cap']/1000:.0f}B" if snap["cap"] is not None
                else f"price-proxy rank {rank:.2f}"
            )
            note = (
                f"Buy {code}: top-{self.a.top_n} tech leader on {d} ({rank_note}); "
                f"rebalance toward equal weight in the monthly basket."
            )
            result = self.sh.cmd(f'account buy {code} {qty} --note="{note}"')
            if "successfully bought" in result:
                self.trades += 1

    def run(self, start, end):
        rng = random.Random(f"{start}:{end}:{self.a.top_n}")
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
                self.sh.cmd(
                    f'account deposit {self.a.monthly * n_months} --note="Monthly contribution x{n_months}"'
                )
                self.rebalance(d)
        return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--years", type=int, default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--panel", required=True)
    ap.add_argument("--sector-map", dest="sector_map", required=True)
    ap.add_argument("--session", default="default")
    ap.add_argument("--initial", type=int, default=200000)
    ap.add_argument("--monthly", type=int, default=2500)
    ap.add_argument("--top-n", dest="top_n", type=int, default=10)
    ap.add_argument("--sector-token", dest="sector_token", default="Information Technology")
    ap.add_argument("--gate", choices=["auto", "proxy"], default="auto")
    ap.add_argument("--proxy-years", dest="proxy_years", type=int, default=1)
    ap.add_argument("--proxy-min-price", dest="proxy_min_price", type=float, default=5.0)
    ap.add_argument("--hop-min", dest="hop_min", type=int, default=15)
    ap.add_argument("--hop-max", dest="hop_max", type=int, default=30)
    ap.add_argument("--strategy-version", dest="strategy_version", default="tech-top10-v1")
    ap.add_argument("--out", default=None)
    ap.add_argument("--ledger", default=os.path.join(os.path.dirname(__file__), "tech_top10_ledger.jsonl"))
    args = ap.parse_args()

    end = resolve_end_date(args.start, args.years, args.end)
    panel = Panel(args.panel)
    with open(args.sector_map) as handle:
        sector_map = json.load(handle)

    print(
        f"Panel: {len(panel.codes)} codes, tech universe {sum(1 for c in panel.codes if args.sector_token.lower() in (sector_map.get(c) or '').lower())}. "
        f"Window {args.start} -> {end} (session={args.session})"
    )
    sh = Shell(session=args.session)
    runner = TechTopRunner(sh, panel, sector_map, args)
    t0 = time.time()
    end_date = runner.run(args.start, end)

    modes = ",".join(sorted(runner.modes)) or "none"
    summary = (
        f"Top-{args.top_n} tech-leaders index: each month hold only the largest {args.top_n} "
        f"Information Technology names available as of the simulation date, equal-weight them, "
        f"and fully rebalance monthly. Pre-cap windows use a clearly flagged price proxy ({modes})."
    )
    build = (
        f'report build --json --strategy="Top-{args.top_n} Tech Leaders Monthly Rebalance" '
        f'--strategy-version={args.strategy_version} '
        f'--strategy-summary="{summary}" '
        f'--objective="Own only the date-appropriate top tech leaders with no hindsight" '
        f'--objective-metric="Annualized return and edge vs equal-weight S&P 500, drawdown-aware" '
        f'--objective-constraint="Hold at most {args.top_n} names" '
        f'--objective-constraint="Information Technology sector only (static classification map)" '
        f'--objective-constraint="Monthly equal-weight rebalance; no look-ahead" '
        f'--market-regime="full-window {args.start} to {end}" '
        f'--note="Mechanical top-tech monthly rebalance; session {args.session}; ranking mode(s): {modes}."'
    )
    rep = sh.js(build)
    sh.close()

    sim = rep.get("simulation", {})
    bench = rep.get("benchmark", {})
    pf = rep.get("portfolio", {})
    ann, bann = sim.get("annualizedReturnPct"), bench.get("annualizedReturnPct")
    edge = (ann - bann) if (ann is not None and bann is not None) else None
    row = {
        "start": args.start,
        "end": end_date,
        "requestedEnd": end,
        "strategy": f"Top-{args.top_n} Tech Leaders Monthly Rebalance",
        "version": args.strategy_version,
        "modes": modes,
        "topN": args.top_n,
        "endingValue": sim.get("endingValue"),
        "totalReturnPct": sim.get("totalReturnPct"),
        "annualizedReturnPct": ann,
        "benchmarkAnnualizedPct": bann,
        "edgeAnnualizedPct": edge,
        "maxDrawdownPct": pf.get("maxDrawdownPct"),
        "largestPositionPct": pf.get("largestPositionPct"),
        "rebalances": runner.rebalances,
        "trades": runner.trades,
        "secs": round(time.time() - t0, 1),
    }
    with open(args.ledger, "a") as handle:
        handle.write(json.dumps(row) + "\n")
    if args.out:
        with open(args.out, "w") as handle:
            json.dump(rep, handle, indent=1)
    print("RESULT " + json.dumps(row))


if __name__ == "__main__":
    main()
