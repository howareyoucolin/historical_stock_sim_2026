#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT="$ROOT/tools/unapproved/sweep_out"
STOP_FILE="$OUT/STOP_AUTOPILOT"
LAB_SCRIPT="$ROOT/tools/approved/autopilot_factor_lab.sh"
EXP_SCRIPT="$ROOT/tools/approved/autopilot_factor_explorer.sh"

mkdir -p "$OUT"
rm -f "$STOP_FILE"

start_if_needed() {
  local name=$1
  local script=$2
  local pid_file="$OUT/${name}.pid"
  local log_file="$OUT/${name}.log"

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid=$(tr -d ' \n\r' < "$pid_file")
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
      echo "$name already running (pid=$existing_pid)"
      echo "  log: $log_file"
      return
    fi
  fi

  : > "$log_file"
  nohup bash "$script" >> "$log_file" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$pid_file"
  echo "started $name (pid=$pid)"
  echo "  log: $log_file"
}

start_if_needed "autopilot_factor_lab" "$LAB_SCRIPT"
start_if_needed "autopilot_factor_explorer" "$EXP_SCRIPT"

echo "leaderboard:"
echo "  $OUT/leaderboard.md"
echo "stop file:"
echo "  $STOP_FILE"
