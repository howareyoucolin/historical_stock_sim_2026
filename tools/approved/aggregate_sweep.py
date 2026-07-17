#!/usr/bin/env python3
import argparse
import csv
import glob
import json
import os
import re
from pathlib import Path
from statistics import mean


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "tools" / "unapproved" / "sweep_out"

KNOWN_REPORT_IDS = {
    "momq-2001": 60,
    "momq-2006": 61,
    "momq-2011": 62,
    "momq-2016": 63,
    "momq-2021": 64,
    "valmom-2001": 65,
    "valmom-2006": 66,
    "valmom-2011": 67,
    "valmom-2016": 68,
    "valmom-2021": 69,
    "earn-2001": 70,
    "earn-2006": 71,
    "earn-2011": 72,
    "earn-2016": 73,
    "earn-2021": 74,
    "lowvol-2006": 75,
}

UPLOAD_RE = re.compile(r'^\{"ok":true,"id":(\d+)\}\s*$')


def load_json(path):
    with open(path) as fh:
        return json.load(fh)


def parse_upload_ids():
    ids = dict(KNOWN_REPORT_IDS)
    current = None

    for path in sorted(glob.glob(os.path.join(str(OUT_DIR), "*.log"))):
        with open(path) as fh:
            for raw in fh:
                line = raw.strip()
                if path.endswith("continue.log"):
                    if line.startswith("re-upload "):
                        current = line.split()[1].rstrip(":")
                        continue
                    if line.startswith(">>> finishing "):
                        current = line.split()[-1]
                        continue
                    if line.startswith("-- uploading "):
                        current = line.split()[2]
                        continue
                else:
                    if line.startswith("======== "):
                        current = line.split()[1]
                        continue
                    if line.startswith("-- uploading "):
                        current = line.split()[2]
                        continue

                m = UPLOAD_RE.match(line)
                if m and current:
                    ids[current] = int(m.group(1))
    return ids


def load_seed_rows(path):
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        obj = json.load(fh)
    return obj.get("rows", [])


def ledger_rows():
    upload_ids = parse_upload_ids()
    rows_by_session = {}

    for row in load_seed_rows(os.path.join(str(OUT_DIR), "leaderboard.json")):
        session = row.get("session")
        if session:
            rows_by_session[session] = row

    for path in sorted(glob.glob(os.path.join(str(OUT_DIR), "*.jsonl"))):
        with open(path) as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                item = json.loads(raw)
                start = item.get("start", "")
                strategy = item.get("strategy")
                session = item.get("version") or os.path.basename(path).replace(".jsonl", "")
                if not strategy or not re.match(r"^\d{4}-\d{2}-\d{2}$", start):
                    continue
                rows_by_session[session] = {
                    "session": session,
                    "strategy": strategy,
                    "window": start[:4],
                    "reportId": upload_ids.get(session),
                    "annualizedReturnPct": item.get("annualizedReturnPct"),
                    "edgeAnnualizedPct": item.get("edgeAnnualizedPct"),
                    "maxDrawdownPct": item.get("maxDrawdownPct"),
                    "endingValue": item.get("endingValue"),
                }

    return list(rows_by_session.values())


def format_pct(value):
    return "—" if value is None else f"{value:+.1f}"


def write_csv(rows, path):
    with open(path, "w", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "strategy_rank",
                "strategy",
                "avg_edge_pct",
                "window",
                "report_id",
                "annualized_return_pct",
                "edge_pct",
                "max_drawdown_pct",
                "session",
                "ending_value",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    args = ap.parse_args()

    rows = ledger_rows()
    if not rows:
        raise SystemExit("No factor-sweep session reports found.")

    strategy_edges = {}
    for row in rows:
        if row.get("edgeAnnualizedPct") is None:
            continue
        strategy_edges.setdefault(row["strategy"], []).append(row["edgeAnnualizedPct"])

    rows = [row for row in rows if row.get("annualizedReturnPct") is not None and row.get("edgeAnnualizedPct") is not None]
    if not rows:
        raise SystemExit("No complete factor-sweep rows found.")

    ranked = sorted(
        (
            {
                "strategy": strategy,
                "avgEdgePct": mean(edges),
                "count": len(edges),
            }
            for strategy, edges in strategy_edges.items()
        ),
        key=lambda x: x["avgEdgePct"],
        reverse=True,
    )
    rank_map = {item["strategy"]: idx + 1 for idx, item in enumerate(ranked)}
    avg_map = {item["strategy"]: item["avgEdgePct"] for item in ranked}

    detailed = sorted(
        rows,
        key=lambda r: (-avg_map[r["strategy"]], int(r["window"]), r["strategy"]),
    )

    csv_rows = [
        {
            "strategy_rank": rank_map[row["strategy"]],
            "strategy": row["strategy"],
            "avg_edge_pct": f"{avg_map[row['strategy']]:.3f}",
            "window": row["window"],
            "report_id": row["reportId"] or "",
            "annualized_return_pct": f"{row['annualizedReturnPct']:.3f}",
            "edge_pct": f"{row['edgeAnnualizedPct']:.3f}",
            "max_drawdown_pct": "" if row["maxDrawdownPct"] is None else f"{row['maxDrawdownPct']:.3f}",
            "session": row["session"],
            "ending_value": "" if row["endingValue"] is None else f"{row['endingValue']:.2f}",
        }
        for row in detailed
    ]

    os.makedirs(args.out_dir, exist_ok=True)
    csv_path = os.path.join(args.out_dir, "leaderboard.csv")
    json_path = os.path.join(args.out_dir, "leaderboard.json")
    md_path = os.path.join(args.out_dir, "leaderboard.md")

    write_csv(csv_rows, csv_path)
    with open(json_path, "w") as fh:
        json.dump({"rankedStrategies": ranked, "rows": detailed}, fh, indent=2)

    lines = []
    lines.append("# Factor Sweep Leaderboard")
    lines.append("")
    lines.append("Directional only: these factors are proxies built from available close/EPS/P/E/cap data, not literal implementations with dividends, ROE, FCF, or analyst estimates.")
    lines.append("")
    lines.append("## Strategy Ranking (by average annualized edge vs equal-weight S&P)")
    lines.append("")
    lines.append("| Rank | Strategy | Avg Edge | Windows |")
    lines.append("|---|---|---:|---:|")
    for idx, item in enumerate(ranked, start=1):
        lines.append(f"| {idx} | {item['strategy']} | {item['avgEdgePct']:+.1f}% | {item['count']} |")
    lines.append("")
    lines.append("## Detailed Windows")
    lines.append("")
    lines.append("| Rank | Strategy | Window | Report ID | Ann Return | Edge | Max DD | Session |")
    lines.append("|---|---|---:|---:|---:|---:|---:|---|")
    for row in detailed:
        rid = row["reportId"] if row["reportId"] is not None else ""
        lines.append(
            f"| {rank_map[row['strategy']]} | {row['strategy']} | {row['window']} | {rid} | "
            f"{format_pct(row['annualizedReturnPct'])}% | {format_pct(row['edgeAnnualizedPct'])}% | "
            f"{format_pct(row['maxDrawdownPct'])}% | {row['session']} |"
        )

    with open(md_path, "w") as fh:
        fh.write("\n".join(lines) + "\n")

    print(json.dumps({"ok": True, "rows": len(detailed), "leaderboard": md_path}))


if __name__ == "__main__":
    main()
