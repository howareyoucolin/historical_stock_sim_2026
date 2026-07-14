"""Build a local price/fundamentals panel from the CLI, once, for reuse.

Pulls `stock history` (a sim-date-bounded stock command) for every listed code
with the reader sessions parked at the data boundary (default 2026-06-26), so each
series covers the full available history. The cached panel is then sliced
`date <= checkpoint` by the backtester to walk forward with no look-ahead — the
same panel serves every rolling window, so the ~12-min pull happens only once.

Only isolated, throwaway reader sessions are touched (never `default`), and the
data comes through the CLI, not the raw DB. Output is one JSON file:

    {code: {"d":[dates], "c":[close], "e":[ttmEps], "p":[peRatio], "m":[marketCap]}}

Usage:
    python3 build_price_panel.py --boundary 2026-06-26 --workers 6 --out <path>
"""
import argparse, json, os, sys, time, threading, queue
sys.path.insert(0, os.path.dirname(__file__))
from cli_shell import Shell


# One worker: owns a reader session parked at the boundary, drains codes, pulls history.
def worker(wid, boundary, jobs, results, errors, progress):
    # NOTE: do NOT call `account init` here. It wipes the ENTIRE user-sessions/
    # directory (all sessions), so parallel workers clobber each other's date and
    # some sessions fall back to 2001-01-02 -> `stock history` then returns only the
    # 2001 row (or nothing for post-2001 IPOs). A fresh session defaults to
    # 2001-01-02 and `date set` moves it forward to the boundary on its own file.
    sh = Shell(session=f"panelbuild{wid}")
    sh.cmd(f"date set {boundary}")
    while True:
        try:
            code = jobs.get_nowait()
        except queue.Empty:
            break
        try:
            h = sh.js(f"stock history {code}")
            rows = h.get("rows", [])
            results[code] = {
                "d": [r["date"] for r in rows],
                "c": [r["close"] for r in rows],
                "v": [r.get("volume") for r in rows],
                "e": [r["ttmEps"] for r in rows],
                "p": [r["peRatio"] for r in rows],
                "m": [r["marketCap"] for r in rows],
            }
        except Exception as ex:
            errors[code] = str(ex)
        finally:
            progress[0] += 1
            jobs.task_done()
    sh.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boundary", default="2026-06-26")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "price_panel.json"))
    ap.add_argument("--limit", type=int, default=0, help="cap number of codes (debug)")
    args = ap.parse_args()

    lister = Shell(session="panelbuild_list")
    codes = lister.js("stock list")
    lister.close()
    if isinstance(codes, dict):
        codes = codes.get("stocks") or codes.get("codes") or []
    if args.limit:
        codes = codes[:args.limit]
    total = len(codes)
    print(f"Building panel for {total} codes @ {args.boundary} with {args.workers} workers")

    jobs = queue.Queue()
    for c in codes:
        jobs.put(c)
    results, errors, progress = {}, {}, [0]
    threads = [threading.Thread(target=worker, args=(i, args.boundary, jobs, results, errors, progress))
               for i in range(args.workers)]
    t0 = time.time()
    for t in threads:
        t.start()
    while any(t.is_alive() for t in threads):
        time.sleep(5)
        print(f"  {progress[0]}/{total} ({time.time()-t0:.0f}s)", flush=True)
    for t in threads:
        t.join()

    with open(args.out, "w") as f:
        json.dump(results, f)
    dced = [c for c, v in results.items() if v["d"]]
    print(f"Done: {len(results)} codes, {len(dced)} non-empty, {len(errors)} errors, "
          f"{time.time()-t0:.0f}s -> {args.out}")
    if errors:
        print("First errors:", dict(list(errors.items())[:5]))


if __name__ == "__main__":
    main()
