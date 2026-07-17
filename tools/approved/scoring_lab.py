"""Four-window scoring-script lab for StockSimulate2026.

Runs ONE agent-authored scoring script across the four anchored windows, ranks the whole
~950-name universe each month from a monthly-metrics panel, holds the top 15 at rank-weighted
(linear-decay) sizing, rebalances monthly, and records the result to the website DB
(report_scoring_experiments) plus an optional learning row (report_scoring_lessons). The
variable under test is the SCRIPT; sizing, windows, funding, and the objective are fixed
harness policy so scripts stay comparable.

  windows (annualized gain each): 2006-07-03..2011-06-30, 2011-07-01..2016-06-30,
                                  2016-07-01..2021-06-30, 2021-07-01..2026-06-26
  weighted_gain = .16 g06 + .24 g11 + .28 g16 + .32 g21   (recency-weighted)
  justified_gain = weighted_gain - stddev(the four gains) (the leaderboard objective)

Backtest engine: an in-process monthly rebalance over the panel's month-end series, valued on
adj_close (dividend-total-return). Per-window gain is the money-weighted annualized return
(XIRR on the deposit cash flows + ending value) -- the same metric the project's `report build`
computes. This is what the scoring skill always intended (simulate over monthly rows), and it
is ~1000x faster and more robust than driving the CLI for tens of thousands of trades.

No look-ahead / no hindsight:
  - Signals come only from the metrics panel, sliced `month_end <= checkpoint` (bisect).
  - Quarter-derived fundamentals (incl. forward_eps/forward_pe/peg) are exposed only once
    `fiscal_quarter + reporting_lag <= month_end` (the importer attaches a quarter on its END
    date with no filing lag -- a real leak this runner corrects).
  - The scoring script runs in a restricted namespace (no imports / files / network): it can
    only ever read the point-in-time features handed to it.
  - Ranking at month_end d uses d's own month-end metrics and trades at d's close (standard
    close-to-close convention; the close is observed before trading on it).

Usage:
    python3 scoring_lab.py --script scoring_scripts/exp_001.py --panel metrics_panel.json \
        [--reporting-lag-days 60] [--top-n 15] [--upsert] \
        [--lesson "..."] [--lesson-direction improve] [--parent-test-key exp_000]
"""
import argparse, bisect, json, math, os, statistics, subprocess, sys, time
import datetime as dt

# --- fixed harness policy -----------------------------------------------------
BOUNDARY = "2026-06-26"
WINDOWS = [
    ("2006-07-03", "2011-06-30", "gain_2006"),
    ("2011-07-01", "2016-06-30", "gain_2011"),
    ("2016-07-01", "2021-06-30", "gain_2016"),
    ("2021-07-01", "2026-06-26", "gain_2021"),
]
RECENCY_WEIGHTS = [0.16, 0.24, 0.28, 0.32]  # one per window, oldest -> newest

# Quarter-derived fields that must be reporting-lagged (never point-in-time on quarter end).
FUNDAMENTAL_FIELDS = [
    "eps_ttm", "eps_growth_pct", "forward_eps", "revenue_ttm", "revenue_growth_pct",
    "operating_income_ttm", "operating_income_growth_pct", "free_cash_flow_ttm",
    "free_cash_flow_growth_pct", "operating_margin_pct", "free_cash_flow_margin_pct",
]
# Point-in-time price/trend/vol/liquidity/dividend fields (safe as-of month_end).
PRICE_FIELDS = [
    "close", "adj_close", "return_1m_pct", "return_3m_pct", "return_6m_pct", "return_12m_pct",
    "momentum_12_1_pct", "high_52w", "from_52w_high_pct", "ma_200d", "from_200d_ma_pct",
    "realized_vol_3m", "avg_daily_volume_3m", "avg_daily_dollar_volume_3m", "trading_days_3m",
    "dividend_ttm", "dividend_yield_ttm_pct",
]


def _days_before(datestr, days):
    return (dt.date.fromisoformat(datestr) - dt.timedelta(days=days)).isoformat()


# --- panel access -------------------------------------------------------------
class MetricsPanel:
    """Immutable monthly-metrics series per symbol; every read is `month_end <= d`."""

    def __init__(self, path, reporting_lag_days):
        with open(path) as fh:
            raw = json.load(fh)
        self.stocks = raw["stocks"]
        self.lag = reporting_lag_days
        self.symbols = [s for s, v in self.stocks.items() if v.get("me")]

    # Index of the most recent month_end row <= d for a symbol, or None.
    def _idx(self, sym, d):
        me = self.stocks[sym]["me"]
        i = bisect.bisect_right(me, d) - 1
        return i if i >= 0 else None

    # adj_close as-of d (latest month_end <= d), even if stale -> used for valuation and for
    # liquidating a delisted holding at its last known price.
    def adj_price(self, sym, d):
        i = self._idx(sym, d)
        if i is None:
            return None
        col = self.stocks[sym].get("adj_close") or []
        v = col[i] if i < len(col) else None
        return v if (v and v > 0) else None

    # Latest index j <= i whose quarter-date column value is present and <= (d - lag).
    def _lagged_quarter_idx(self, sym, i, d, quarter_col):
        qcol = self.stocks[sym].get(quarter_col) or []
        cutoff = _days_before(d, self.lag)
        j = -1
        for k in range(i + 1):
            q = qcol[k] if k < len(qcol) else None
            if q is not None and q <= cutoff:
                j = k
        return j if j >= 0 else None

    # Point-in-time feature dict for a symbol as-of d, or None if not currently trading.
    # Fundamentals are lag-honest; pe/forward_pe/peg/market_cap are revalued at the current
    # close so only the *quarter inputs* carry the filing lag.
    def features(self, sym, d, fresh_days=45):
        i = self._idx(sym, d)
        if i is None:
            return None
        s = self.stocks[sym]
        if s["me"][i] < _days_before(d, fresh_days):  # stale -> delisted/not trading, drop
            return None
        close = s["close"][i] if i < len(s["close"]) else None
        if close is None or close <= 0:
            return None

        row = {"symbol": sym, "date": d, "month_end": s["me"][i]}
        for f in PRICE_FIELDS:
            col = s.get(f) or []
            row[f] = col[i] if i < len(col) else None

        jf = self._lagged_quarter_idx(sym, i, d, "fundamentals_quarter")
        for f in FUNDAMENTAL_FIELDS:
            col = s.get(f) or []
            row[f] = (col[jf] if (jf is not None and jf < len(col)) else None)
        eps, feps, growth = row.get("eps_ttm"), row.get("forward_eps"), row.get("eps_growth_pct")
        row["pe"] = (close / eps) if (eps is not None and eps > 0) else None
        row["forward_pe"] = (close / feps) if (feps is not None and feps > 0) else None
        row["peg"] = (row["pe"] / growth) if (row["pe"] is not None and growth is not None and growth > 0) else None

        jc = self._lagged_quarter_idx(sym, i, d, "market_cap_quarter")
        shares = (s.get("shares_outstanding") or [None])[jc] if (jc is not None) else None
        row["shares_outstanding"] = shares
        row["market_cap"] = (shares * close) if shares is not None else None
        return row

    # One rebalance date per calendar month in [start, end]: the true last trading day of the
    # month (the max month_end that month). Using the raw union would add spurious dates from
    # delisted names' partial-month last-trading-days and over-count monthly deposits.
    def calendar(self, start, end):
        by_month = {}
        for s in self.symbols:
            for me in self.stocks[s]["me"]:
                if start <= me <= end:
                    ym = me[:7]
                    if ym not in by_month or me > by_month[ym]:
                        by_month[ym] = me
        return [by_month[ym] for ym in sorted(by_month)]


# --- regime (point-in-time, from the cross-section) ---------------------------
def compute_regime(rows, breadth_threshold=0.5):
    above = [r for r in rows if r.get("from_200d_ma_pct") is not None]
    breadth = (sum(1 for r in above if r["from_200d_ma_pct"] > 0) / len(above)) if above else None
    vols = [r["realized_vol_3m"] for r in rows if r.get("realized_vol_3m") is not None]
    momo = [r["momentum_12_1_pct"] for r in rows if r.get("momentum_12_1_pct") is not None]
    dists = [r["from_200d_ma_pct"] for r in above]
    return {
        "bull": (breadth is not None and breadth >= breadth_threshold),
        "breadth": breadth,
        "avg_realized_vol_3m": (statistics.mean(vols) if vols else None),
        "median_momentum_12_1_pct": (statistics.median(momo) if momo else None),
        "median_from_200d_ma_pct": (statistics.median(dists) if dists else None),
        "universe_size": len(rows),
    }


# --- helper context handed to the scoring script ------------------------------
class Ctx:
    def __init__(self, rows, regime, date):
        self._rows = rows
        self.regime = regime
        self.date = date

    # Cross-sectional z-scores for a metric across the eligible universe: {symbol: z or None}.
    def z(self, key):
        vals = [(r["symbol"], r.get(key)) for r in self._rows]
        present = [v for _, v in vals if v is not None]
        if len(present) < 3:
            return {s: None for s, _ in vals}
        mu = statistics.mean(present)
        sd = statistics.pstdev(present) or 1.0
        return {s: ((v - mu) / sd if v is not None else None) for s, v in vals}


# --- restricted script execution ---------------------------------------------
def load_script(path):
    with open(path) as fh:
        src = fh.read()
    safe_names = [
        "abs", "min", "max", "sum", "len", "sorted", "round", "float", "int", "bool",
        "range", "enumerate", "zip", "list", "dict", "set", "tuple", "map", "filter",
        "any", "all", "isinstance", "str", "reversed",
    ]
    import builtins as _b
    safe_builtins = {n: getattr(_b, n) for n in safe_names}
    ns = {"__builtins__": safe_builtins, "math": math, "statistics": statistics}
    exec(compile(src, os.path.basename(path), "exec"), ns)
    if "score_universe" not in ns or not callable(ns["score_universe"]):
        raise SystemExit(f"{path}: must define score_universe(stocks, regime, ctx)")
    return ns["score_universe"], {
        "formula_name": ns.get("FORMULA_NAME") or os.path.splitext(os.path.basename(path))[0],
        "logic_variant_count": int(ns.get("LOGIC_VARIANT_COUNT", 1)),
        "notes": ns.get("NOTES"),
        "source": src,
    }


# --- money-weighted annualized return (XIRR), matching report build's method --
def xirr(flows):
    d0 = dt.date.fromisoformat(flows[0][0])

    def xnpv(r):
        return sum(a / ((1 + r) ** ((dt.date.fromisoformat(dd) - d0).days / 365.0)) for dd, a in flows)

    lo, hi = -0.9999, 10.0
    flo = xnpv(lo)
    for _ in range(200):
        mid = (lo + hi) / 2.0
        fm = xnpv(mid)
        if abs(fm) < 1e-6:
            return mid
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2.0


# --- backtest one window (in-process) -----------------------------------------
class WindowRunner:
    def __init__(self, panel, score_fn, args):
        self.panel, self.score_fn, self.a = panel, score_fn, args
        self.rebalances = 0
        self.bull_months = 0
        self.total_months = 0
        self.window_label = ""
        self.picks = []  # per-month top-N selections: {window_label, month_end, rank, symbol, score, weight_pct}

    # Rank the universe as-of d and return [(symbol, weight, score)] for the top-N (linear-decay).
    def _targets(self, d):
        rows = [f for f in (self.panel.features(s, d) for s in self.panel.symbols) if f is not None]
        regime = compute_regime(rows) if rows else {}
        if len(rows) < self.a.top_n:
            return [], regime
        scores = self.score_fn(rows, regime, Ctx(rows, regime, d))
        eligible = {r["symbol"] for r in rows}
        ranked = sorted(
            ((s, sc) for s, sc in (scores or {}).items()
             if s in eligible and isinstance(sc, (int, float)) and math.isfinite(sc)),
            key=lambda kv: kv[1], reverse=True,
        )
        top = ranked[: self.a.top_n]
        if not top:
            return [], regime
        m = len(top)
        raw = [m - i for i in range(m)]
        total = sum(raw)
        return [(top[i][0], raw[i] / total, top[i][1]) for i in range(m)], regime

    # Monthly full rebalance to the rank weights over the window; records the top-N picks each
    # month and returns annualized XIRR %.
    def run(self, start, end, label):
        self.window_label = label
        cal = self.panel.calendar(start, end)
        if len(cal) < 6:
            raise SystemExit(f"too few month-ends in {start}..{end}")
        shares = {}
        cash = 0.0
        flows = []  # (date, signed amount): deposits negative, ending value positive
        for k, d in enumerate(cal):
            deposit = (self.a.initial + self.a.monthly) if k == 0 else self.a.monthly
            cash += deposit
            flows.append((d, -deposit))
            targets, regime = self._targets(d)
            self.rebalances += 1
            self.total_months += 1
            if regime and regime.get("bull"):
                self.bull_months += 1
            # record this month's ranked picks (the stocks selected), for later study
            for rank, (code, w, sc) in enumerate(targets, start=1):
                self.picks.append({
                    "window_label": label, "month_end": d, "rank": rank, "symbol": code,
                    "score": round(float(sc), 6), "weight_pct": round(w * 100.0, 4),
                })
            # liquidate everything to cash at as-of prices (costless; delisted names sell at last close)
            for code, qty in list(shares.items()):
                p = self.panel.adj_price(code, d)
                if p:
                    cash += qty * p
                shares.pop(code, None)
            if not targets:
                continue  # too few eligible names -> hold cash this month
            equity = cash
            for code, w, sc in targets:
                p = self.panel.adj_price(code, d)
                if not p:
                    continue
                target_val = w * equity
                shares[code] = target_val / p  # fractional shares -> exact rank weights
                cash -= target_val
        # end-of-window valuation
        last = cal[-1]
        ending = cash + sum(q * (self.panel.adj_price(c, last) or 0) for c, q in shares.items())
        flows.append((last, ending))
        return xirr(flows) * 100.0, ending


# --- DB writes via the website PHP importers ----------------------------------
def _php_importer(importer, payload):
    proc = subprocess.run(
        ["docker", "exec", "-i", "stock_report_php", "php",
         f"/var/www/html/data/importers/{importer}"],
        input=json.dumps(payload), capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"{importer} failed: {proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout.strip()


def _fetch_parent_justified(parent_test_key):
    if not parent_test_key:
        return None
    out = subprocess.run(
        ["docker", "exec", "-i", "stock_report_mysql", "mysql", "-ustock_user", "-pstock_pass",
         "stock_report", "--batch", "-N", "-e",
         f"SELECT justified_gain_pct FROM report_scoring_experiments WHERE test_key='{parent_test_key}'"],
        capture_output=True, text=True,
    )
    val = out.stdout.strip()
    try:
        return float(val) if val and val != "NULL" else None
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True, help="path to the scoring script (defines score_universe)")
    ap.add_argument("--panel", default=os.path.join(os.path.dirname(__file__), "..", "unapproved", "metrics_panel.json"))
    ap.add_argument("--test-key", dest="test_key", default=None, help="DB row key (default: script basename)")
    ap.add_argument("--top-n", dest="top_n", type=int, default=15)
    ap.add_argument("--reporting-lag-days", dest="reporting_lag_days", type=int, default=60)
    ap.add_argument("--initial", type=int, default=200000)
    ap.add_argument("--monthly", type=int, default=2500)
    ap.add_argument("--upsert", action="store_true", help="write the result to report_scoring_experiments")
    ap.add_argument("--lesson", default=None, help="learning text to append to report_scoring_lessons")
    ap.add_argument("--lesson-direction", dest="lesson_direction", default="neutral",
                    choices=["improve", "degrade", "neutral"])
    ap.add_argument("--parent-test-key", dest="parent_test_key", default=None)
    ap.add_argument("--out", default=None, help="also write the result JSON here")
    args = ap.parse_args()

    score_fn, meta = load_script(args.script)
    args.test_key = args.test_key or os.path.splitext(os.path.basename(args.script))[0]

    panel = MetricsPanel(args.panel, args.reporting_lag_days)
    print(f"Panel: {len(panel.symbols)} symbols. Script: {meta['formula_name']} "
          f"(variants={meta['logic_variant_count']}, lag={args.reporting_lag_days}d)", flush=True)

    t0 = time.time()
    gains = {}
    all_picks = []
    for start, end, key in WINDOWS:
        runner = WindowRunner(panel, score_fn, args)
        label = f"{start[:4]}-{end[:4]}"
        g, ending = runner.run(start, end, label)
        gains[key] = g
        all_picks.extend(runner.picks)
        print(f"  {key} {start}..{end}: annualized {g:6.2f}%  end ${ending:,.0f}  "
              f"(bull {runner.bull_months}/{runner.total_months} mo)", flush=True)

    g_list = [gains["gain_2006"], gains["gain_2011"], gains["gain_2016"], gains["gain_2021"]]
    weighted = sum(w * g for w, g in zip(RECENCY_WEIGHTS, g_list))
    dispersion = statistics.pstdev(g_list)
    justified = weighted - dispersion

    result = {
        "test_key": args.test_key,
        "formula_name": meta["formula_name"],
        "window_2006_2011_gain_pct": round(gains["gain_2006"], 4),
        "window_2011_2016_gain_pct": round(gains["gain_2011"], 4),
        "window_2016_2021_gain_pct": round(gains["gain_2016"], 4),
        "window_2021_2026_gain_pct": round(gains["gain_2021"], 4),
        "weighted_gain_pct": round(weighted, 4),
        "window_dispersion_pct": round(dispersion, 4),
        "justified_gain_pct": round(justified, 4),
        "logic_variant_count": meta["logic_variant_count"],
        "secs": round(time.time() - t0, 1),
    }
    print("RESULT " + json.dumps(result), flush=True)
    if args.out:
        with open(args.out, "w") as fh:
            json.dump(result, fh, indent=2)

    if args.upsert:
        _php_importer("report_scoring_experiment_upsert.php", {
            "test_key": args.test_key,
            "formula_name": meta["formula_name"],
            "scoring_definition": meta["source"],
            "definition_format": "python",
            "window_2006_2011_gain_pct": result["window_2006_2011_gain_pct"],
            "window_2011_2016_gain_pct": result["window_2011_2016_gain_pct"],
            "window_2016_2021_gain_pct": result["window_2016_2021_gain_pct"],
            "window_2021_2026_gain_pct": result["window_2021_2026_gain_pct"],
            "weighted_gain_pct": result["weighted_gain_pct"],
            "window_dispersion_pct": result["window_dispersion_pct"],
            "justified_gain_pct": result["justified_gain_pct"],
            "logic_variant_count": result["logic_variant_count"],
            "notes": meta.get("notes") or "",
        })
        print(f"Upserted experiment {args.test_key} (justified_gain {justified:.2f}%).", flush=True)
        _php_importer("report_scoring_picks_replace.php", {
            "test_key": args.test_key,
            "picks": all_picks,
        })
        print(f"Recorded {len(all_picks)} monthly pick(s) for {args.test_key}.", flush=True)

    if args.lesson:
        parent_j = _fetch_parent_justified(args.parent_test_key)
        delta = round(justified - parent_j, 4) if parent_j is not None else None
        evidence = args.test_key + (f",{args.parent_test_key}" if args.parent_test_key else "")
        _php_importer("report_scoring_lesson_insert.php", {
            "lesson": args.lesson,
            "direction": args.lesson_direction,
            "metric": "justified_gain_pct",
            "metric_delta": delta,
            "parent_test_key": args.parent_test_key,
            "evidence_test_keys": evidence,
            "regime_context": f"4-window; weighted={weighted:.1f}%, dispersion={dispersion:.1f}%",
        })
        print("Appended lesson to report_scoring_lessons.", flush=True)


if __name__ == "__main__":
    main()
