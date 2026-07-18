#!/usr/bin/env python3
"""Append one line to the LOCAL automation_log table — the automation's local archive/heartbeat.

This is the local source of truth for "is the automation alive and progressing". A separate
job (stock_report_website/deploy/push_logs.sh) mirrors the latest ~500 rows to prod as a JSON
file every minute for remote viewing at /logs.php, and prunes this table to 100k rows. A local
watchdog (tools/approved/watchdog.sh) reads this table's newest timestamp to decide staleness.

The table is created lazily (CREATE TABLE IF NOT EXISTS in the same call) so there is no shared
migration and prod never gets an unused table — logging is entirely a LOCAL concern.

Usage:
    python3 alog.py "starting exp_236 backtest" --level info --source supervisor --test-key exp_236
    from alog import log; log("published exp_236", source="supervisor", test_key="exp_236")
"""
import argparse, os, subprocess, sys

CONTAINER = os.environ.get("STOCKAI_DB_CONTAINER", "stock_report_mysql")
DB = os.environ.get("STOCKAI_DB_NAME", "stock_report")
USER = os.environ.get("STOCKAI_DB_USER", "stock_user")
PW = os.environ.get("STOCKAI_DB_PASS", "stock_pass")

DDL = (
    "CREATE TABLE IF NOT EXISTS automation_log ("
    "id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
    "ts DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),"
    "level VARCHAR(10) NOT NULL DEFAULT 'info',"
    "source VARCHAR(64) NULL,"
    "test_key VARCHAR(64) NULL,"
    "message TEXT NOT NULL,"
    "KEY idx_automation_log_ts (ts));"
)


# Escape a Python value into a single-quoted SQL string literal.
def _lit(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


# Insert one log row (creating the table first if needed). Returns the mysql exit code.
def log(message, level="info", source=None, test_key=None):
    if level not in ("debug", "info", "warn", "error"):
        level = "info"
    sql = DDL + (
        "INSERT INTO automation_log (level, source, test_key, message) VALUES ("
        f"{_lit(level)}, {_lit(source)}, {_lit(test_key)}, {_lit(message)});"
    )
    proc = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "mysql", f"-u{USER}", f"-p{PW}", DB, "-e", sql],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write((proc.stderr or proc.stdout).strip() + "\n")
    return proc.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("message")
    ap.add_argument("--level", default="info", choices=["debug", "info", "warn", "error"])
    ap.add_argument("--source", default=None)
    ap.add_argument("--test-key", dest="test_key", default=None)
    args = ap.parse_args()
    sys.exit(log(args.message, args.level, args.source, args.test_key))


if __name__ == "__main__":
    main()
