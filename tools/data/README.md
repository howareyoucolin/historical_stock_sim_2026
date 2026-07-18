# tools/data — shippable benchmark data

Small, **git-tracked** reference data the V2 scoring lab compares against. Unlike the
`metrics_panel.json` (62 MB, DB-derived, regenerated per checkout under git-ignored
`unapproved/`), these files are small and stable, so they live here and sync to every checkout.
The `scoring-script-autopilot-v2` skill and `approved/scoring_lab_v2.py` reference this folder by
default.

## Files

- **`spy_benchmark.json`** — the benchmark **price series** (the single source of truth), shaped
  `{"benchmark": "<code>", "me": [month_end...], "price": [total_return_level...]}`. The runner
  loads it with `--benchmark spy` (this path is the default `--benchmark-file`) and computes the
  benchmark XIRR for **every** rolling window in-process, with the same deposits/dates/dividends/
  XIRR as the strategy — so the benchmark stays perfectly consistent and supports any window size.

- **`spy_xirr_by_year.json`** — a human-readable year→XIRR summary (one 5-year window per start
  year). **Debug/inspection only — never the source of truth.**

## ⚠️ Current file is an INTERIM PROXY, not real SPY

No SPY data exists in the project yet, so `spy_benchmark.json` currently holds the **cap-weight
universe proxy** (`"benchmark": "CAPW_UNIV"` — the same benchmark generation as an in-process
`scoring_lab_v2.py --benchmark capw` run, so file-based and in-process results stay comparable).
The runner records `benchmark_code = CAPW_UNIV` — obviously not `SPY`, so nothing is mislabeled.
Only compare `relative_return` across experiments sharing the same `benchmark_code`.

## Replacing the proxy with real SPY

When you have a dividend-adjusted (total-return) monthly SPY series `spy_source.json`
(`{"me": [...], "adj_close": [...]}`), regenerate both files in place:

```
python3 tools/approved/build_spy_benchmark.py --spy-file spy_source.json
# writes tools/data/spy_benchmark.json (benchmark="SPY") + tools/data/spy_xirr_by_year.json
```

Then every `scoring_lab_v2.py --benchmark spy` run uses real SPY automatically. SPY-benchmarked
rows carry `benchmark_code = SPY`; treat them as a new benchmark generation (don't rank them
against the old proxy runs).

To refresh the interim proxy instead (e.g. after regenerating the panel):
`python3 tools/approved/build_spy_benchmark.py --source proxy`.
