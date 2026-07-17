#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID="${1:?usage: watch_continue_sweep.sh <continue_sweep_pid>}"
cd "$ROOT"

mkdir -p tools/unapproved/sweep_out
LOG=tools/unapproved/sweep_out/finalize.log

{
  echo "watching continue_sweep pid=$PID"
  while kill -0 "$PID" 2>/dev/null; do
    sleep 60
  done
  echo "continue_sweep exited; building leaderboard"
  python3 tools/approved/aggregate_sweep.py
  echo "leaderboard build complete"
} >> "$LOG" 2>&1
