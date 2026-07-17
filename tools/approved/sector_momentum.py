"""Sector-momentum rotation backtester for StockSimulate2026 — the no-look-ahead cousin of
the (hindsight) supercycle rotation.

Each month, rank sectors by their trailing-K-month return (median of constituents) using ONLY
data as of the sim date, rotate into the single leading sector, and hold its top-N names
(equal-weight). Optionally go to cash when even the best sector's momentum is negative
(absolute-momentum guard). The winning theme is discovered mechanically from price action —
never chosen with foreknowledge — so this is a legitimate "ride the supercycle" strategy.

Sector labels are STATIC classification (undated) loaded from a cached map, so they carry no
look-ahead risk. All dated data (returns, prices, cap) comes from the sim-date-bounded panel,
and all trades go through the CLI on the session. Reuses the approved cli_shell + Panel.

Usage:
    python3 sector_momentum.py --start 2016-07-01 --years 5 --panel <panel.json> \
        --sector-map <sector_map.json> --session sectmom-2016 --lookback-months 6 --top-n 5
"""
import argparse, json, os, sys, time, random, bisect, statistics, datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "approved"))
from cli_shell import Shell
from dip_backtest import Panel, add_years, months_between

# Sectors excluded from rotation (not real investable GICS sectors).
EXCLUDED_SECTORS = {"unknown", "Speculative Growth & Theme Baskets", None, ""}


class SectorMomentum:
    def __init__(self, panel, sector_map, args):
        self.p = panel
        self.a = args
        # code -> sector, restricted to codes present in the panel and real sectors.
        self.sector_of = {c: sector_map.get(c) for c in panel.codes}
        self.by_sector = {}
        for code, sec in self.sector_of.items():
            if sec in EXCLUDED_SECTORS:
                continue
            self.by_sector.setdefault(sec, []).append(code)
        self.lookback_days = max(21, int(args.lookback_months * 21))

    # Trailing return of a code over the lookback window, as-of date d (None if insufficient data).
    def trailing_return(self, code, d):
        v = self.p.raw[code]
        ds = v["d"]
        i = bisect.bisect_right(ds, d) - 1
        j = i - self.lookback_days
        if i < 0 or j < 0:
            return None
        now, then = v["c"][i], v["c"][j]
        # require the series to be current (not delisted before d)
        if ds[i] < (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat():
            return None
        if now is None or then is None or then <= 0:
            return None
        return now / then - 1.0

    # Sector momentum score as-of d under the chosen metric. cap-weighted (default) reflects how a
    # sector *index* moves and captures concentrated mega-cap leadership (e.g. AI-era Tech); median
    # understates such sectors, mean is in between.
    def _sector_score(self, codes, d):
        pairs = []  # (ret, cap)
        for c in codes:
            r = self.trailing_return(c, d)
            if r is None:
                continue
            snap = self.p.asof(c, d)
            cap = snap["cap"] if snap else None
            pairs.append((r, cap))
        if len(pairs) < self.a.min_sector_names:
            return None
        rets = [r for r, _ in pairs]
        if self.a.sector_metric == "median":
            return statistics.median(rets)
        if self.a.sector_metric == "mean":
            return statistics.mean(rets)
        # cap-weighted: only over names with a known cap; fall back to mean when caps are absent
        # (e.g. the pre-2007 era), so early windows still rank.
        capped = [(r, m) for r, m in pairs if m and m > 0]
        tot = sum(m for _, m in capped)
        return sum(r * m for r, m in capped) / tot if tot > 0 else statistics.mean(rets)

    # Rank sectors by the trailing-return score as-of d; return sorted [(sector, score)].
    def rank_sectors(self, d):
        ranked = []
        for sec, codes in self.by_sector.items():
            score = self._sector_score(codes, d)
            if score is not None:
                ranked.append((sec, score))
        ranked.sort(key=lambda x: x[1], reverse=True)
        return ranked

    # The top-N holdings for date d: the leading sector's top names, each with its as-of snapshot.
    # Returns (sector_name, [(code, snap)]). Empty when the cash guard trips or nothing qualifies.
    def target(self, d):
        ranked = self.rank_sectors(d)
        if not ranked:
            return None, []
        lead_sector, lead_mom = ranked[0]
        # Absolute-momentum guard: if even the best sector is falling, hold cash.
        if self.a.cash_guard and lead_mom <= 0:
            return "CASH", []

        cutoff = (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat()
        cands = []
        for code in self.by_sector[lead_sector]:
            snap = self.p.asof(code, d)
            if snap is None or snap["asof_date"] < cutoff:
                continue
            r = self.trailing_return(code, d)
            if r is None:
                continue
            cands.append((code, snap, r))
        # Rank within the sector by market cap when available (own the leaders), else by momentum.
        cap_era = any(s["cap"] is not None for _, s, _ in cands)
        cands.sort(key=lambda cs: (cs[1]["cap"] or 0.0) if cap_era else cs[2], reverse=True)
        return lead_sector, [(c, s) for c, s, _ in cands[: self.a.top_n]]


class Runner:
    def __init__(self, sh, panel, strat, args):
        self.sh, self.p, self.strat, self.a = sh, panel, strat, args
        self.rebalances = 0
        self.trades = 0
        self.sectors_held = []  # ordered log of leading sector at each rebalance

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

    def rebalance(self, d):
        self.rebalances += 1
        sector, targets = self.strat.target(d)
        if sector and (not self.sectors_held or self.sectors_held[-1] != sector):
            self.sectors_held.append(sector)
        target_codes = {c for c, _ in targets}
        snap_by = {c: s for c, s in targets}
        acct = self._account()
        holdings = self._holdings(acct)

        # Exit anything not in the current leading-sector top-N (rotation / cash guard).
        for code in list(holdings.keys()):
            if code in target_codes:
                continue
            note = f"Rotate out {code}: not in leading sector '{sector}' top-{self.a.top_n} as of {d} (sector-momentum)."
            r = self.sh.cmd(f'account sell {code} all --note="{note}"')
            if "successfully sold" in r:
                self.trades += 1

        if not targets:
            return  # cash guard or nothing qualifies -> stay in cash

        acct = self._account()
        holdings = self._holdings(acct)
        cash = float(acct["cash"])
        equity = cash + sum(holdings.get(c, 0) * snap_by[c]["close"] for c in target_codes)
        per_name = equity / len(targets)
        min_buy = max(200.0, 0.02 * equity)

        deficits = []
        for code, snap in targets:
            cur = holdings.get(code, 0) * snap["close"]
            deficit = per_name - cur
            if deficit >= min_buy:
                deficits.append((code, snap, deficit))
        total = sum(x[2] for x in deficits)
        if total <= 0:
            return
        scale = min(1.0, (cash * 0.999) / total)
        for code, snap, deficit in deficits:
            amt = int(deficit * scale)
            if amt < min_buy:
                continue
            held = "add to" if holdings.get(code, 0) else "new"
            note = (f"Sector-momentum {sector} ({held}): {code} at {snap['close']:.2f}, "
                    f"equal-weight ~${per_name:,.0f} (leading sector by trailing {self.a.lookback_months}mo return).")
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
    ap.add_argument("--sector-map", dest="sector_map", required=True)
    ap.add_argument("--session", default="default")
    ap.add_argument("--initial", type=int, default=200000)
    ap.add_argument("--monthly", type=int, default=2500)
    ap.add_argument("--top-n", dest="top_n", type=int, default=5)
    ap.add_argument("--lookback-months", dest="lookback_months", type=int, default=6)
    ap.add_argument("--min-sector-names", dest="min_sector_names", type=int, default=5)
    ap.add_argument("--sector-metric", dest="sector_metric", choices=["capweight", "mean", "median"], default="capweight",
                    help="how to score a sector's trailing return: capweight (index-like; default), mean, or median")
    ap.add_argument("--cash-guard", dest="cash_guard", action="store_true", help="go to cash when the best sector's momentum <= 0")
    ap.add_argument("--hop-min", dest="hop_min", type=int, default=15)
    ap.add_argument("--hop-max", dest="hop_max", type=int, default=30)
    ap.add_argument("--strategy-version", dest="strategy_version", default="sectmom-v1")
    ap.add_argument("--out", default=None)
    ap.add_argument("--ledger", default=os.path.join(os.path.dirname(__file__), "sector_momentum_ledger.jsonl"))
    args = ap.parse_args()

    end = add_years(args.start, args.years)
    panel = Panel(args.panel)
    with open(args.sector_map) as f:
        sector_map = json.load(f)
    strat = SectorMomentum(panel, sector_map, args)
    print(f"Panel: {len(panel.codes)} codes, {len(strat.by_sector)} sectors. Window {args.start} -> {end} (session={args.session})")

    sh = Shell(session=args.session)
    runner = Runner(sh, panel, strat, args)
    t0 = time.time()
    end_date = runner.run(args.start, end)

    guard = "with cash guard" if args.cash_guard else "always invested"
    seq = " -> ".join(runner.sectors_held) or "none"
    summary = (f"No-look-ahead sector-momentum rotation: each month hold the top-{args.top_n} names of the "
               f"single sector leading on trailing {args.lookback_months}-month return (median of constituents), "
               f"equal-weight, {guard}; monthly contributions. Sector picked mechanically from price action — "
               f"no foreknowledge. Sector path: {seq}.")
    build = (f'report build --json --strategy="Sector-Momentum Rotation (top-{args.top_n}, {args.lookback_months}mo)" '
             f'--strategy-version={args.strategy_version} '
             f'--strategy-summary="{summary}" '
             f'--objective="Ride whichever sector is leading on trailing momentum, chosen mechanically" '
             f'--objective-metric="Annualized return and edge vs equal-weight S&P 500, drawdown-aware" '
             f'--objective-constraint="Hold only the leading sector by trailing {args.lookback_months}mo return" '
             f'--objective-constraint="Top-{args.top_n} equal-weight; monthly rebalance; no look-ahead" '
             f'--market-regime="rolling 5y {args.start[:4]}-{end[:4]}" '
             f'--note="No-hindsight sector-momentum rotation; CLI-executed. Sector path: {seq}."')
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
        "start": args.start, "end": end_date, "years": args.years,
        "strategy": f"Sector-Momentum Rotation (top-{args.top_n}, {args.lookback_months}mo)", "version": args.strategy_version,
        "sectorsHeld": runner.sectors_held,
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
