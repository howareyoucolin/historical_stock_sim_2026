"""Generic cross-sectional factor-rank backtester for StockSimulate2026.

Each month, score every eligible stock on a factor composite computed ONLY from data as of the
sim date, hold the top-N equal-weight, and rebalance monthly. One engine, many strategies via
--strategy presets. All factors are z-scored across the eligible universe and combined by weight.

Data note: the panel carries close / TTM EPS / P/E / market cap (fundamentals ~2007+). It has NO
dividends, ROE, margins, FCF, debt, or analyst estimates, so the academic factors are implemented
as the best mechanical PROXY from available data (documented per preset + labeled in the report):
  - momentum      : 12-1 trailing return (skip the most recent month)
  - value         : earnings yield (EPS/price = 1/PE), higher = cheaper
  - quality       : TTM-EPS growth + profitability gate (no ROE/margin/FCF available)
  - earnings-rev  : TTM-EPS growth / acceleration (no analyst revisions available)
  - low-vol       : negative trailing realized volatility of daily returns
  - shareholder-yield : buyback yield = share-count shrink (shares=cap/price); NO dividends in data
  - small-cap     : negative market cap (smaller = higher), gated to a mid/small band

No look-ahead: every value uses rows dated <= the checkpoint. Trades go through the CLI on the
session. Reuses the approved cli_shell + Panel.

Usage:
    python3 factor_rank.py --start 2016-07-01 --years 5 --panel <panel.json> \
        --session momq-2016 --strategy mom-quality --top-n 15
"""
import argparse, json, os, sys, time, random, bisect, math, statistics, datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "approved"))
from cli_shell import Shell
from dip_backtest import Panel, add_years, months_between

TRADING_YEAR = 252
MONTH = 21


# ---- per-stock factor primitives (as-of date d, no look-ahead) --------------
class Factors:
    def __init__(self, panel):
        self.p = panel

    def _idx(self, code, d):
        ds = self.p.raw[code]["d"]
        i = bisect.bisect_right(ds, d) - 1
        return i if i >= 0 else None

    def _fresh(self, code, d, i):
        return self.p.raw[code]["d"][i] >= (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat()

    def close(self, code, d):
        i = self._idx(code, d)
        return self.p.raw[code]["c"][i] if i is not None else None

    def eps(self, code, d):
        i = self._idx(code, d)
        return self.p.raw[code]["e"][i] if i is not None else None

    def cap(self, code, d):
        i = self._idx(code, d)
        return self.p.raw[code]["m"][i] if i is not None else None

    # 12-1 momentum: return from ~12 months ago to ~1 month ago (skips the most recent month).
    def mom_12_1(self, code, d):
        v = self.p.raw[code]; i = self._idx(code, d)
        if i is None or i - TRADING_YEAR < 0:
            return None
        a, b = v["c"][i - MONTH], v["c"][i - TRADING_YEAR]
        return a / b - 1.0 if (a and b and b > 0) else None

    # trailing return over `days` (no skip) — used for filters/other.
    def ret(self, code, d, days):
        v = self.p.raw[code]; i = self._idx(code, d)
        if i is None or i - days < 0:
            return None
        a, b = v["c"][i], v["c"][i - days]
        return a / b - 1.0 if (a and b and b > 0) else None

    def earnings_yield(self, code, d):
        c, e = self.close(code, d), self.eps(code, d)
        return e / c if (c and e is not None and c > 0) else None

    # TTM EPS growth over ~1 year (proxy for quality trend / earnings revision).
    def eps_growth(self, code, d):
        v = self.p.raw[code]; i = self._idx(code, d)
        if i is None or i - TRADING_YEAR < 0:
            return None
        now, then = v["e"][i], v["e"][i - TRADING_YEAR]
        if now is None or then is None or then <= 0:
            return None
        return now / then - 1.0

    # Realized volatility of daily returns over `window` days (lower is better for low-vol).
    def volatility(self, code, d, window=126):
        v = self.p.raw[code]; i = self._idx(code, d)
        if i is None or i - window < 0:
            return None
        rets = []
        for k in range(i - window + 1, i + 1):
            a, b = v["c"][k], v["c"][k - 1]
            if a and b and b > 0:
                rets.append(a / b - 1.0)
        return statistics.pstdev(rets) if len(rets) > 5 else None

    # Buyback yield proxy: shrink in share count (shares = cap/price) over ~1 year. + = net buyback.
    def buyback_yield(self, code, d):
        v = self.p.raw[code]; i = self._idx(code, d)
        if i is None or i - TRADING_YEAR < 0:
            return None
        cn, mn = v["c"][i], v["m"][i]
        cp, mp = v["c"][i - TRADING_YEAR], v["m"][i - TRADING_YEAR]
        if not (cn and mn and cp and mp and cn > 0 and cp > 0):
            return None
        sh_now, sh_then = mn / cn, mp / cp
        return (sh_then - sh_now) / sh_then if sh_then > 0 else None


# ---- strategy presets: (universe gate, {factor: weight}, description) --------
# gate(f, code, d) -> bool ; factors reference Factors methods by name.
def _profitable(f, code, d, min_cap_m):
    e, m = f.eps(code, d), f.cap(code, d)
    return e is not None and e > 0 and m is not None and m >= min_cap_m


STRATEGIES = {
    "pure-momentum": dict(
        label="Pure Momentum",
        gate=lambda f, c, d, a: (f.close(c, d) or 0) >= a.min_price and (f.cap(c, d) is None or f.cap(c, d) >= a.min_cap * 1000),
        weights={"mom_12_1": 1.0},
        note="12-1 price momentum only; no fundamentals required, broad liquid universe.",
    ),
    "mom-quality": dict(
        label="Momentum + Quality (proxy)",
        gate=lambda f, c, d, a: _profitable(f, c, d, a.min_cap * 1000),
        weights={"mom_12_1": 0.5, "eps_growth": 0.5},
        note="12-1 momentum + TTM-EPS-growth quality proxy (no ROE/margin/FCF in data), profitable cap>=floor.",
    ),
    "value-mom": dict(
        label="Value + Momentum (proxy)",
        gate=lambda f, c, d, a: _profitable(f, c, d, a.min_cap * 1000),
        weights={"earnings_yield": 0.5, "mom_12_1": 0.5},
        note="Earnings yield (1/PE) + 12-1 momentum, profitable cap>=floor.",
    ),
    "value-mom-quality": dict(
        label="Value + Momentum + Quality (proxy)",
        gate=lambda f, c, d, a: _profitable(f, c, d, a.min_cap * 1000),
        weights={"earnings_yield": 0.4, "mom_12_1": 0.35, "eps_growth": 0.25},
        note="Blend of earnings yield, 12-1 momentum, and TTM-EPS-growth quality proxy; profitable cap>=floor.",
    ),
    "earnings-growth": dict(
        label="Earnings Revision (EPS-growth proxy)",
        gate=lambda f, c, d, a: _profitable(f, c, d, a.min_cap * 1000),
        weights={"eps_growth": 1.0},
        note="TTM-EPS growth as a proxy for earnings revision/drift (no analyst estimates in data).",
    ),
    "low-vol": dict(
        label="Low Volatility",
        gate=lambda f, c, d, a: (f.close(c, d) or 0) >= a.min_price and (f.cap(c, d) is None or f.cap(c, d) >= a.min_cap * 1000),
        weights={"neg_volatility": 1.0},
        note="Lowest trailing 6-month realized volatility; non-penny names.",
    ),
    "shareholder-yield": dict(
        label="Shareholder Yield (buyback proxy)",
        gate=lambda f, c, d, a: f.cap(c, d) is not None and f.cap(c, d) >= a.min_cap * 1000,
        weights={"buyback_yield": 1.0},
        note="Buyback yield = 1yr share-count shrink (shares=cap/price). NO dividends in data, so buyback-only.",
    ),
    "shareholder-momentum": dict(
        label="Shareholder Yield + Momentum (proxy)",
        gate=lambda f, c, d, a: f.cap(c, d) is not None and f.cap(c, d) >= a.min_cap * 1000,
        weights={"buyback_yield": 0.6, "mom_12_1": 0.4},
        note="Buyback-yield proxy plus 12-1 momentum to avoid value traps; cap>=floor.",
    ),
    "small-cap-quality": dict(
        label="Small-Cap Quality (proxy)",
        gate=lambda f, c, d, a: (f.eps(c, d) or -1) > 0 and f.cap(c, d) is not None and a.small_min * 1000 <= f.cap(c, d) <= a.small_max * 1000,
        weights={"neg_cap": 0.4, "eps_growth": 0.3, "mom_12_1": 0.3},
        note="Smaller-cap (in a mid/small band) + EPS-growth quality + momentum; profitable.",
    ),
    "small-cap-value-quality": dict(
        label="Small-Cap Value + Quality (proxy)",
        gate=lambda f, c, d, a: (f.eps(c, d) or -1) > 0 and f.cap(c, d) is not None and a.small_min * 1000 <= f.cap(c, d) <= a.small_max * 1000,
        weights={"neg_cap": 0.3, "earnings_yield": 0.3, "eps_growth": 0.2, "mom_12_1": 0.2},
        note="Mid/small profitable companies tilted to smaller size, cheaper valuation, EPS growth, and momentum.",
    ),
    "adaptive-factor": dict(
        label="Adaptive Momentum -> Shareholder Value (proxy)",
        gate=lambda f, c, d, a: ((f.close(c, d) or 0) >= a.min_price and (f.cap(c, d) is None or f.cap(c, d) >= a.min_cap * 1000))
        if d < a.fundamentals_start else _profitable(f, c, d, a.min_cap * 1000),
        weights=lambda d, a: {"mom_12_1": 1.0}
        if d < a.fundamentals_start
        else {"earnings_yield": 0.35, "mom_12_1": 0.35, "buyback_yield": 0.15, "eps_growth": 0.15},
        note="Before fundamentals exist: pure momentum. After fundamentals arrive: blend shareholder-yield, value, momentum, and EPS growth.",
    ),
}


class Runner:
    def __init__(self, sh, panel, args):
        self.sh, self.p, self.a = sh, panel, args
        self.f = Factors(panel)
        self.preset = STRATEGIES[args.strategy]
        self.rebalances = 0
        self.trades = 0
        self.modes = set()

    def _date(self):
        return self.sh.js("date show")["date"]

    # Fast read: cash + per-code share counts (no per-holding valuation). We value holdings from
    # the panel's as-of close ourselves, so we never need the heavy `account show` view.
    def _state(self):
        return self.sh.js("account cash")

    def _holdings(self, state):
        return {c: q for c, q in (state.get("positions") or {}).items() if q}

    # raw factor value (with neg_* wrappers) for a code as-of d
    def _factor(self, name, code, d):
        if name == "neg_volatility":
            v = self.f.volatility(code, d, self.a.vol_window)
            return -v if v is not None else None
        if name == "neg_cap":
            m = self.f.cap(code, d)
            return -m if m is not None else None
        return getattr(self.f, name)(code, d)

    def _weights(self, d):
        weights = self.preset["weights"]
        return weights(d, self.a) if callable(weights) else weights

    # top-N codes by z-scored factor composite among eligible names as-of d, with as-of close.
    def target(self, d):
        weights = self._weights(d)
        cutoff = (dt.date.fromisoformat(d) - dt.timedelta(days=15)).isoformat()
        eligible = []
        for code in self.p.codes:
            i = self.f._idx(code, d)
            if i is None or self.p.raw[code]["d"][i] < cutoff:
                continue
            if not self.preset["gate"](self.f, code, d, self.a):
                continue
            vals = {name: self._factor(name, code, d) for name in weights}
            if any(v is None for v in vals.values()):
                continue
            eligible.append((code, vals))
        if len(eligible) < max(self.a.top_n, self.a.min_universe):
            return []  # not enough names with the needed data -> hold cash
        # z-score each factor across the eligible set, then composite.
        zc = {}
        for name in weights:
            xs = [v[name] for _, v in eligible]
            mu = statistics.mean(xs); sd = statistics.pstdev(xs) or 1.0
            zc[name] = (mu, sd)
        scored = []
        for code, vals in eligible:
            score = sum(weights[name] * ((vals[name] - zc[name][0]) / zc[name][1]) for name in weights)
            scored.append((code, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        top = [c for c, _ in scored[: self.a.top_n]]
        return [(c, self.f.close(c, d)) for c in top]

    def rebalance(self, d):
        self.rebalances += 1
        targets = self.target(d)
        tgt = {c for c, _ in targets}
        px = {c: p for c, p in targets}
        state = self._state()
        holdings = self._holdings(state)

        for code in list(holdings.keys()):
            if code in tgt:
                continue
            r = self.sh.cmd(f'account sell {code} all --note="Factor rebalance: {code} left the {self.a.strategy} top-{self.a.top_n} as of {d}."')
            if "successfully sold" in r:
                self.trades += 1

        if not targets:
            self.modes.add("cash")
            return
        self.modes.add("invested")
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
            r = self.sh.cmd(f'account buy {code} --amount={amt} --note="{self.preset["label"]}: {code} in top-{self.a.top_n} by factor score, equal-weight ~${per:,.0f}."')
            if "successfully bought" in r:
                self.trades += 1

    def run(self, start, end):
        rng = random.Random(start + self.a.strategy)
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
    ap.add_argument("--strategy", required=True, choices=list(STRATEGIES))
    ap.add_argument("--initial", type=int, default=200000)
    ap.add_argument("--monthly", type=int, default=2500)
    ap.add_argument("--top-n", dest="top_n", type=int, default=15)
    ap.add_argument("--min-universe", dest="min_universe", type=int, default=15)
    ap.add_argument("--min-cap", dest="min_cap", type=float, default=2.0, help="min market cap ($B) for the universe gate")
    ap.add_argument("--min-price", dest="min_price", type=float, default=5.0)
    ap.add_argument("--small-min", dest="small_min", type=float, default=0.3, help="small-cap band low ($B)")
    ap.add_argument("--small-max", dest="small_max", type=float, default=10.0, help="small-cap band high ($B)")
    ap.add_argument("--fundamentals-start", dest="fundamentals_start", default="2007-01-01",
                    help="first date when fundamentals-based factors are considered broadly available")
    ap.add_argument("--vol-window", dest="vol_window", type=int, default=126)
    ap.add_argument("--hop-min", dest="hop_min", type=int, default=15)
    ap.add_argument("--hop-max", dest="hop_max", type=int, default=30)
    ap.add_argument("--strategy-version", dest="strategy_version", default="fr-v1")
    ap.add_argument("--out", default=None)
    ap.add_argument("--ledger", default=os.path.join(os.path.dirname(__file__), "factor_rank_ledger.jsonl"))
    args = ap.parse_args()

    end = add_years(args.start, args.years)
    panel = Panel(args.panel)
    preset = STRATEGIES[args.strategy]
    print(f"Panel: {len(panel.codes)} codes. {preset['label']} | Window {args.start} -> {end} (session={args.session})")
    sh = Shell(session=args.session)
    runner = Runner(sh, panel, args)
    t0 = time.time()
    end_date = runner.run(args.start, end)

    modes = ",".join(sorted(runner.modes)) or "none"
    summary = (f"{preset['label']}: monthly, hold top-{args.top_n} equal-weight by a z-scored factor composite "
               f"computed as-of the sim date (no look-ahead). {preset['note']} Regime: {modes}.")
    build = (f'report build --json --strategy="{preset["label"]}" '
             f'--strategy-version={args.strategy_version} '
             f'--strategy-summary="{summary}" '
             f'--objective="Test the {preset["label"]} factor on a rolling window" '
             f'--objective-metric="Annualized return and edge vs equal-weight S&P 500, drawdown-aware" '
             f'--objective-constraint="Top-{args.top_n} equal-weight, monthly rebalance, no look-ahead" '
             f'--objective-constraint="Proxy factor from available data (see summary)" '
             f'--market-regime="rolling {args.years}y {args.start[:4]}-{end[:4]}" '
             f'--note="Factor-rank engine; {args.strategy}; CLI-executed; proxy factors ({preset["note"]})."')
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
        "start": args.start, "end": end_date, "years": args.years, "strategy": preset["label"],
        "preset": args.strategy, "version": args.strategy_version,
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
