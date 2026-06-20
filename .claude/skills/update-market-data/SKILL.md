---
name: update-market-data
description: Refresh the per-stock market data this project simulates on, and add new tickers to the universe — re-download price history, re-scrape EPS, and rebuild the combined data files through this project's CLI. Use when the user asks to update/refresh/re-seed the market data, extend the data date range (e.g. bump the end date to today), add one or more new tickers/stocks to the universe, or fix missing/stale market-data files. See commands.md for the full command surface.
---

# Update Market Data

Refresh the data under `market-data/<CODE>/` using only this project's CLI. This
is an **engineering/maintenance** task (extending or rebuilding the dataset), not
the trading role-play — so reading config files and the data is fine here.

## What you are maintaining

Each ticker has **three files**, produced by three steps, and they must all be
present and consistent:

| File | Produced by | Source |
| --- | --- | --- |
| `history.json` | `stock download <code>` | Yahoo Finance (daily closes + dividends) |
| `eps.json` | `stock scrape-eps <code>` | Macrotrends (TTM Net EPS) |
| `data.json` | `stock build <code>` | combines the two + derives P/E, shares, **market cap** |

`stock seed` runs all three for every ticker in `config/tickers.json`.

### Config that drives the data

- **`config/download-date-range.json`** — the `start`/`end` window for downloads.
  Edit `end` to extend the dataset over time (e.g. to today), then re-download.
  This is the canonical file the code reads (don't confuse it with any stray
  `data-range.json`).
- **`config/tickers.json`** — the universe `seed` iterates over.
- **`config/shares-outstanding.json`** — shares per ticker, used by `build` to
  derive `marketCap` (`close × shares`). ETFs are omitted → null market cap.

## Critical: the commands SKIP when the output exists

`download`, `scrape-eps`, and `build` each **skip if their output file already
exists**. So just re-running `stock seed` over existing data changes nothing. To
truly refresh, you must **delete the files first**.

## Workflow (full refresh of all tickers)

1. **Set the window.** If extending the range, edit `end` (and/or `start`) in
   `config/download-date-range.json`. Note Yahoo's end bound is effectively
   exclusive: an `end` of `2026-06-15` yields data through the last trading day
   *before* it (e.g. Fri `2026-06-12`). Use the day after the target if you need
   the target date included.
2. **Back up first.** A network re-fetch can partially fail, and deleting before
   re-fetching is destructive. Copy `market-data/` somewhere safe (e.g. a temp
   dir) so failed tickers can be restored.
3. **Clear the three files** so the steps actually run:
   `rm -f market-data/*/history.json market-data/*/eps.json market-data/*/data.json`.
4. **Re-seed:** `npm run cli -- stock seed`. This downloads, scrapes EPS, and
   builds for every ticker. It is **slow** — Macrotrends rate-limits EPS scraping
   with multi-second backoffs — so run it in the background and monitor progress
   (it streams `[n/72]` lines and ends with an `x ok / y skipped / z failed`
   summary per step).
5. **Patch failures from the backup.** Some tickers legitimately fail
   `scrape-eps` (e.g. **ETFs like VOO** return a Macrotrends 404 — they have no
   EPS), which then fails their `build`. For each such ticker: restore its
   `eps.json` from the backup, then `npm run cli -- stock build <code>` to
   regenerate `data.json` from the freshly downloaded `history.json` + restored
   `eps.json`.
6. **Verify** (see below) before declaring done.

### Refreshing one ticker (or a few)

Skip `seed`; for each code delete its three files, then run the three steps:
`stock download <code>` → `stock scrape-eps <code>` → `stock build <code>`.

### Adding new ticker(s) to the universe

Adding tickers does **not** require touching existing data — the new symbols have
no files yet, so the steps run for them without any delete/back-up. This applies
whether the user names one symbol or a batch.

1. **Add the symbols to `config/tickers.json`** (this is the universe `seed`,
   `stock list`, and the screener use). Add every requested symbol.
2. **Add shares outstanding** for each new symbol to
   `config/shares-outstanding.json` (in millions) so market cap is populated;
   omit ETFs (they get null market cap). If you don't have an exact figure, use a
   reasonable approximate current count and say so — the file is easy to correct.
3. **Build each new ticker's three files** — `stock download <code>` →
   `stock scrape-eps <code>` → `stock build <code>` for each. A full
   `npm run cli -- stock seed` also works and is convenient for a batch: it
   skips tickers that already have files and only does the new ones (it will not
   refresh existing tickers — for that, use the delete-then-seed full refresh
   above).
4. **Verify each new ticker** ends up with all three files, the right
   `range.end`, and a market cap (or null for an ETF).

Per-ticker failures are normal and must be resolved, not left behind:
- **`download` fails / "No historical price data"** — the symbol may be wrong,
  delisted, or not on Yahoo. Confirm the ticker with the user; remove it from
  `config/tickers.json` if it isn't valid.
- **`scrape-eps` 404 / no EPS** (common for ETFs and some very recent IPOs) —
  there is no backup to restore for a brand-new ticker, so write a minimal
  `market-data/<CODE>/eps.json` with an empty series
  (`{"stockCode":"<CODE>","epsByDate":{}}`) so `stock build <code>` can still
  produce `data.json` (EPS/P/E come out null, which is correct when there are no
  earnings).

### Known bad symbols from the 2026-06-20 bulk add

Do **not** blindly retry these eight symbols in future batch runs unless the
user explicitly asks for a correction pass with replacement tickers or updated
symbols first:

- `PARA`
- `WBA`
- `GPS`
- `JWN`
- `FL`
- `K`
- `DISH`
- `MRO`

All eight failed repeated Yahoo/Macrotrends fetches with 404s in the June 20,
2026 bulk seed. Treat them as **needs-symbol-review**, not transient network
failures. If any partial files exist for them, delete those leftovers before the
next run so the skip-on-existing-output behavior does not preserve bad state.

## Verify before finishing

- **All three files exist for every ticker** — no ticker left with a missing
  `history.json`, `eps.json`, or `data.json`. List `market-data/*/` and confirm.
- **The new range applied** — each `data.json` `range.end` reflects the configured
  window (the last trading day on/before `end`).
- **Market cap is present** — a non-ETF `data.json` row carries `marketCap` and
  `sharesOutstanding`; ETFs carry null. (Rebuilds re-read
  `config/shares-outstanding.json`, so a stale or missing entry shows up as null.)
- Report the seed summary (ok/failed per step) and any tickers you patched.

## Guardrails

- **CLI only** for producing data (`npm run cli -- ...`); don't hand-edit the
  generated JSON except to restore a backed-up file during failure recovery.
- **Always back up `market-data/` before a destructive refresh** so a failed
  network fetch never loses a ticker.
- **Never leave a ticker with missing files.** A downloaded `history.json` with no
  `eps.json`/`data.json` breaks that ticker in the CLI and UI — restore + rebuild.
- The default-session **account is unrelated** to this task; refreshing market
  data does not touch it, and you should not reset or modify it here.
