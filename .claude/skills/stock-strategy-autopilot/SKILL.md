---
name: stock-strategy-autopilot
description: Run stock-trade simulations on autopilot — fully autonomous, no prompts. It loops on its own, deriving improved mechanical strategy variants from the strategies already published on the production site and uploading every report back, to continuously grow the research archive. Use when the user wants a self-driving batch of simulations ("auto-simulate", "keep running simulations", "explore strategies on autopilot", "run the autopilot", "find me a good strategy"). Builds on stock-trade-simulation (per run) and simulation-reporting (per report); uploads each report automatically.
---

# Stock Strategy Autopilot

Drive an open-ended, **fully autonomous** series of stock-trade simulations — it never
prompts the user. Each iteration it picks its own run window and an improved strategy
variant, runs it end to end, builds the report, uploads it to the production site,
leaves an app/market-data suggestion, records the result, and loops. The goal is to
continuously add research results to the prod archive at https://stock.369usa.com.

This skill is the orchestration layer; each run still follows
`.claude/skills/stock-trade-simulation/SKILL.md` and reports follow
`.claude/skills/simulation-reporting/SKILL.md` — **except the autopilot does NOT ask
the four setup questions**; it sets them itself (§1) and never pauses for input.

## Hard rules (inherited from stock-trade-simulation)

Every per-run guardrail from `stock-trade-simulation` applies in full (including its
**Environment** note: the CLI needs **Node 18+**, repo-pinned to **Node 22** via `nvm` /
`dev.sh`, and the market-data API on `localhost:8700`):

- **CLI only for trading decisions.** Within a run, never read source, query the
  market-data API/database directly, or open `user-sessions/` files — interact only
  through `npm run cli -- ...` (its data is already bounded to the simulated date).
  (Orchestration may read the public report feed at stock.369usa.com/feed.php and read
  `.env` for the upload key — those are not trading-data reads.)
- **No hindsight.** Every variant is a mechanical rule decided from data observable as
  of the sim date. Never pick/avoid a ticker by how it really performed (including no
  "reverse hindsight" for deliberately bad controls — make those bad *by rule*).
- **One writer per session.** Never let two runs write the **same** session concurrently,
  and keep the **default** session for single interactive runs. Distinct **named** sessions
  may run in parallel, one OS process each — see §7.
- **Preserve data — one new session per run.** Every run gets its own **new, uniquely-named**
  session and is **kept afterward** (never reset a finished run). Do not reuse or `account
  init` an existing session between runs; the accumulated per-run sessions are the local
  archive that complements the uploaded reports. Only discard a session if the user asks.
- **Mechanical variants only**, so each run can be script-driven.

## 1. Per-run configuration (autonomous — no prompts)

The autopilot sets every parameter itself; it never asks the user. For each run:

- **Time range:** randomly pick **5 or 10 years**.
- **Start date:** pick a random date in `[2001-01-02, 2026-06-26 − range]` so the full
  range fits and the run ends on or before the data boundary `2026-06-26`
  (`end = start + range`). If the start lands on a non-trading day, the run begins on
  the next one. (This guarantees a complete 5y/10y backtest — never a truncated window.)
- **Funding:** initial `$200,000` + `$2,500` on the first trading day of each month.
- **Role + strategy:** first pick a role for the run — **Explorer** (try a new strategy
  *family* or idea) or **Optimizer** (refine an already-promising published strategy) —
  then derive the variant per §3. Unless the user explicitly named specific strategies to
  test, in which case run those.
- **Upload:** always, automatically (§4) — no permission prompt.

Vary randomness by run index/time so successive runs differ; never reuse a
`(range, start, strategy)` combination already in the ledger.

### Named window sets ("default 5-year / 10-year windows")

When the user asks to run over the **default 5-year windows** or **default 10-year
windows**, do NOT pick a random single window. Instead run the **same strategy** across
this fixed set of consecutive windows — sequentially, or (recommended) in parallel with one
named session per window per §7 — uploading each report as it finishes (§4). This is a
rolling backtest of one strategy across eras. Each window starts on the first trading day
on/after its July 1 and ends on the last trading day on/before its June 30 (the final
window is capped at the data boundary `2026-06-26`).

- **default 5-year windows** (5 runs): `2001-07 → 2006-06`, `2006-07 → 2011-06`,
  `2011-07 → 2016-06`, `2016-07 → 2021-06`, `2021-07 → 2026-06`.
- **default 10-year windows** (2 runs): `2006-07 → 2016-06`, `2016-07 → 2026-06`.

Funding and all other per-run settings above still apply. Honor the data-availability
rule (§3): only use fundamentals-driven strategies for windows starting after the data
exists (~2007 fundamentals, ~2010 dividends); for the `2001-07` start, use a price/
momentum/risk-control strategy or a clearly-flagged proxy.

## 2. Keep a sweep ledger

Maintain a running ledger of variants tried so the search adapts and never repeats
itself. Track per variant: id/params, the **run window (start + range)**, ending value,
total & annualized return, **edge over the built-in benchmark**, max drawdown,
after-tax result, and turnover. Store it as a local working file (scratchpad or a
gitignored file) — your memory across iterations, not a deliverable.

**Judge on relative, risk-adjusted performance, not the raw multiple.** The universe is
survivorship-biased, so absolute returns are inflated and only comparisons are
trustworthy. Rank by edge over the benchmark and drawdown/turnover-adjusted return.

> **Benchmark.** `report build` emits a built-in **equal-weight S&P 500 index**
> benchmark in `report.json` (`benchmark` block, `stockCode: "S&P 500 (EW)"`) on the
> same DEPOSIT schedule. Read its figures straight from each report; don't recompute.

## 3. Learn from published research, then improve

Before designing a variant, **read the strategies already published on the production
site** via the machine-readable feed at **https://stock.369usa.com/feed.php**. It
returns every published report distilled to exactly what you need — strategy rules,
run window, performance, and the precomputed annualized **edge over the benchmark** —
as JSON, so prefer it over scraping the HTML archive. Useful params (see
`feed.md` for the full reference):

- `?sort=edge&view=summary` — scan the whole archive ranked by edge over the benchmark.
- `?sort=edge&minEdge=0` — just the strategies that beat the benchmark (your hill-climb targets).
- `?strategy=<substring>` — find prior runs of a family before you reuse it.
- `?id=<n>` — pull one report's full distilled detail (rules, window, takeaways).

Use that to (a) avoid repeating a strategy/window already published, and (b) design an
**improved** variant — adjust the rule or parameter that looks like it held a prior
strategy back. (For the full per-run detail behind any entry, open its
`report.php?id=<id>` page, linked as `url` in the feed.)

Unless the user explicitly asks to test specific strategies, the autopilot's job is to
iteratively improve on what is already published.

Draw improvements from these mechanical families and axes:

- **Families — prioritize breadth across these (all defined mechanically):**
  - **Momentum / strong winners** — hold the top-N by trailing 3/6/12-month return.
  - **Fallen winners** — former leaders now far below their trailing high (e.g. prior
    large-caps down ≥ X% from a 52-week peak); a quality-mean-reversion bet. Screen these
    directly with `stock screen --min-drawdown=X --max-drawdown=Y` (percent below the
    52-week high); `stock status`/`screen` also expose `high52w`/`low52w`/`pctFrom52wHigh`.
  - **Value + growth (GARP)** — low P/E among names whose earnings are still growing.
  - **Thematic hardware basket** — a fixed segment/industry basket (e.g. semiconductors
    / tech hardware) selected *by classification*, never by knowing it would win.
  - **Sector rotation** — each period rotate into the top segments by trailing return
    (segment-bucket momentum).
  - **Defensive switch** — risk-off into defensive segments / low-beta / cash when the
    broad trend or breadth deteriorates; risk-on otherwise.
  - **Dip buying / DCA** — deploy contributions steadily, adding more when price is X%
    below a recent high (find those names with `stock screen --min-drawdown=X`).
  - **Quality compounders** — stable, profitable names held long-term with minimal turnover.
  - **Mean reversion** — buy the largest trailing decliners, trim as they recover.
  - **Risk-control overlays** — volatility targeting, position caps, max-drawdown guards,
    low-vol tilt — layered on any of the above.
  - Plus baselines (equal-/cap-weight top-N, dividend tilt) and clearly-labeled negative
    controls (anti-momentum, high-P/E chase) for contrast.
- **Parameter axes** (Optimizer only — vary one at a time around a base): momentum
  lookback (3/6/12 mo), holding count `top_k`, rebalance cadence (monthly/quarterly/
  annual), hysteresis buffer width, weighting (equal vs cap), universe market-cap floor,
  cash/absolute-momentum guard threshold, position sizing, and trim-winners vs let-run.
- **Data availability:** fundamentals (P/E, EPS) only exist in the data from **~2007**
  and dividends from **~2010**. So pick fundamentals-driven families (value, GARP,
  dividend, quality) only for windows starting after the data exists; for earlier starts
  use price/momentum/risk-control families that need no fundamentals.

### Avoid overfitting — diversity over micro-tuning

The market is complex and unstable, so local optimization easily overfits. Therefore:

- **Don't over-optimize tiny details.** Do not repeatedly nudge small parameters around
  the same idea hoping the edge improves; a result that only survives one specific
  parameter value is noise, not a strategy.
- **Favor strategy diversity.** Spend most iterations covering *different families*
  (above) rather than refining one. A new family teaches more than another decimal place.
- **Attribute, then move on.** When you do tune (Optimizer), change one axis so the
  result is attributable, keep it if the gain is clear and not knife-edge, and after a
  couple of inconclusive tweaks abandon that point and explore elsewhere.

### Two roles: Explorer and Optimizer

Each iteration runs as one of two roles. Bias toward **Explorer** early, when the archive
is thin, or when it has clustered around one idea; shift toward **Optimizer** once a
family shows a real, repeated edge worth deepening. Note the chosen role in the ledger
and in the run's strategy metadata.

- **Explorer — discover new families and ideas.**
  - Goal is breadth: each run tests a *different family* or a genuinely new structural
    idea, not a tweaked parameter.
  - Read **both winners and losers** in the feed (don't filter to `minEdge>0`) — a failed
    report often points to an unexplored direction or a fixable structural flaw.
  - Prefer a new family over a new parameter value; do not fine-tune.

- **Optimizer — improve already-promising strategies.**
  - Only optimize candidates that already beat (or nearly beat) the benchmark
    (`feed.php?sort=edge&minEdge=0`); never tune a dead idea.
  - May adjust one axis at a time: thresholds, position sizing, holding period, rebalance
    cadence, `top_k`, guard levels.
  - Stop after a couple of attempts without clear, robust improvement — log the dead end
    and hand back to Explorer. No endless micro-tuning around the same point.

Always record each variant's rule (and its role) in the report's strategy metadata.

## 4. The autopilot loop (per iteration)

Run sequentially on a single session (default), or fan the loop out across several sessions
in parallel per §7. For each iteration:

1. **Set run params (§1):** random range, random fitting start, and a role + variant (§3)
   — Explorer (new family) or Optimizer (refine a promising published strategy).
2. **Run it** end to end per `stock-trade-simulation`, in a **new uniquely-named session**
   for this run (e.g. `session new <family>-<start>-<range>`, or `--session=<name>` on a
   fresh name, which seeds a clean account) — do **not** reuse or reset a prior session.
   Then `date set <start>`, fund, drive the clock with irregular `date next` hops, make the
   monthly contribution, attach a data-grounded `--note` to every trade, and stop at the
   derived end date. Script the run for mechanical variants.
   - **Build & reuse tools.** Since the autopilot runs many similar mechanical variants,
     invest in **reusable Python drivers saved to `tools/unapproved/`** (recorded in
     `tools/unapproved/INDEX.md`) rather than one-off scripts — e.g. a persistent-CLI-shell
     helper plus a strategy runner parameterized by window/strategy. **Check
     `tools/docs/TOOLS.md` and `tools/unapproved/INDEX.md` first and reuse** an existing
     tool; only add a new one if none fits. Tools must obey every run guardrail (CLI-only,
     no look-ahead). That folder is git-ignored, so this makes no git changes. See the repo
     tools convention (`.claude/CLAUDE.md` / `tools/README.md`).
   - **Scripting for speed:** a multi-year mechanical run is many hundreds of CLI calls.
     Run the CLI once as a persistent interactive shell (`npm run cli`, then feed one
     command per line) so the tsx startup cost is paid once, not per command. Use larger
     `date next` hops (e.g. 15–30 trading days) to cut a 5-year run to a few dozen steps,
     acting only when a new month is crossed. Use `account cash` (cash + share counts, no
     valuation) for the per-step read, and `stock screen --min-drawdown=`/`--max-drawdown=`
     for dip/fallen-winner signals instead of pulling each name's full history.
3. **Build the report** with `report build` per `simulation-reporting`, setting the
   strategy/objective metadata and the run window.
4. **Upload automatically — no prompt.** Read `SECRET_KEY` from `simulator/.env` and
   POST the five session files (from this run's session folder, `user-sessions/<name>/`)
   to `https://stock.369usa.com/insert.php?key=$SECRET_KEY`
   using the multipart shape from `upload-stock-report`. On `ok:true`, **preserve the
   session — do not reset it**; the next iteration simply starts its own new session, so
   the finished run's data stays on disk. If the upload fails, log the exact response and
   continue — leave the session intact so it can be retried.
5. **Record** the result in the ledger (§2).
6. **Leave a suggestion** in `suggestions/` (§5).
7. **Loop.** Surface a one-line progress update (role, window, strategy, edge over
   benchmark, best so far) and continue to the next iteration. Keep looping until the
   user interrupts or says stop.

## 5. Leave a suggestion after every run

After each simulation, write exactly one suggestion file to `suggestions/` (git-ignored).
It is **only** about improving the **app/system or market data** — never a
trading-strategy idea. Follow the convention in `stock-trade-simulation`
(§"Leave an improvement suggestion"):

- **Path:** `suggestions/<YYYY-MM-DD>-<short-slug>.md` (real date; append `-2`, `-3`, … if taken).
- **Content:** category (`app-system` | `market-data`), the source run (strategy +
  session id + report id), the concrete observation, the proposed improvement, and a
  rough priority. Ground it in something the run actually hit. If nothing new surfaced,
  write a one-line note saying so.

## 6. Termination and summary

When the user stops it (or an external limit is hit):

- **Finish the in-flight run cleanly** (build + report + upload + suggestion); never
  abandon a half-done simulation.
- **Produce a leaderboard** of every variant tried, ranked by edge over the benchmark
  and risk-adjusted return, with the run window and the parameter that drove each
  result. Call out the best variant and the clearest dead ends.
- **Point to `suggestions/`** for the accumulated app/market-data notes.

## 7. Running in parallel (multiple sessions)

Independent runs (e.g. the §1 named window sets, or several unrelated strategies) can run
**concurrently, one named session per run**, to cut wall-clock. This is safe because each
session is its own folder (`user-sessions/<name>/`) and `account init` only resets its own
folder. Follow these rules:

- **One OS process per session.** Launch a separate CLI process for each parallel run and
  pin it to a distinct session, passing `--session=<name>` on every command (e.g. `w2001`,
  `w2006`, …). Do **not** run parallel sessions from one process or one interactive shell:
  the active session is process-global, so interleaved in-process commands would write to
  the wrong folder. Give each window/strategy a unique session name.
- **Never share a session or use `default` for parallel runs.** The `default` session and
  the browser UI show one session at a time; reserve it for single interactive runs. One
  writer per session, always.
- **Cap concurrency.** All runs read the same market-data API (`localhost:8700`) and DB, so
  concurrency multiplies load and speedup is sublinear. Use a small pool (≈3–5 at once), not
  dozens; add more only if the API keeps up.
- **Isolate per-run bookkeeping.** Give each parallel run its **own ledger file** (§2) and
  prefix its **suggestion filenames** with the session name, since the `-2/-3` dedup is not
  atomic across processes. Merge the ledgers into one leaderboard at the end (§6).
- **Upload independently.** Each run uploads its own session folder's five files
  (`user-sessions/<name>/…`, §4); concurrent uploads are fine (the server assigns ids).
- **Finish + summarize together.** When stopping, let every in-flight process finish its
  current run cleanly, then merge all ledgers into a single ranked leaderboard.

For the **default 5-year / 10-year window sets** (§1), this is the recommended shape: run
the windows as parallel per-session processes, then merge for the rolling-backtest summary.

## Guardrails

- **Fully autonomous: never prompt the user** — no setup questions, no upload permission.
- Per run: random **5 or 10-year** range + random start so the **full window fits ≤
  `2026-06-26`** (`end = start + range`).
- Improve on the strategies already published at stock.369usa.com (read them via the
  feed at stock.369usa.com/feed.php) unless the user named specific strategies to test.
- **Always upload** each report using `SECRET_KEY` from `simulator/.env`; never ask for
  the key. Upload target is production only (`https://stock.369usa.com`).
- One writer per session (never two runs on the same session or on `default`); parallel
  runs across **distinct named sessions** are allowed, one process each (§7). Mechanical and
  no-hindsight; judge on risk-adjusted edge.
- **Diversity over micro-tuning.** Favor exploring different strategy families over
  repeatedly tweaking small parameters around one idea (the market is unstable — local
  optimization overfits). Run as Explorer (new families) or Optimizer (refine only
  already-promising strategies), and abandon an idea after a couple of inconclusive tweaks.
- Pick fundamentals-based families (value, GARP, dividend, quality) only for windows
  starting after the data exists (~2007 fundamentals, ~2010 dividends).
- Each run leaves exactly one `suggestions/` note (app/market-data only).
- Build the report only at the run's true end date.
