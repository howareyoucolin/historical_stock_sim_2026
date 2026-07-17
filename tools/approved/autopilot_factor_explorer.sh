#!/usr/bin/env bash
# Complementary unattended factor explorer. Uses distinct session slugs and shares the same stop file.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

PANEL=tools/unapproved/price_panel.json
SMAP=tools/approved/sector_map.json
OUT=tools/unapproved/sweep_out
STOP_FILE="$OUT/STOP_AUTOPILOT"
mkdir -p "$OUT"

KEY=$(grep '^SECRET_KEY=' .env | cut -d= -f2- | tr -d '\r\n')
WINDOWS=(2001-07-01 2006-07-01 2011-07-01 2016-07-01 2021-07-01)

upload() {
  local s=$1 d="user-sessions/$1"
  curl -s -X POST "https://stock.369usa.com/insert.php?key=$KEY" \
    -F "report_json_file=@$d/report.json" \
    -F "account_json_file=@$d/account.json" \
    -F "history_log_file=@$d/history.log" \
    -F "meta_json_file=@$d/meta.json" \
    -F "values_log_file=@$d/values.log"
}

run_one() {
  local slug=$1 start=$2; shift 2
  local year="${start:0:4}"
  local session="${slug}-${year}"
  {
    echo "======== $session ($start) ========"
    timeout 7200 "$@" --start "$start" --years 5 --panel "$PANEL" --session "$session" \
      --strategy-version "$session" --ledger "$OUT/${session}.jsonl"
    echo "-- uploading $session --"
    upload "$session"
    echo
    echo "DONE $session"
  } > "$OUT/${session}.log" 2>&1
}

wave() {
  local slug=$1; shift
  echo ">>> WAVE $slug"
  for w in "${WINDOWS[@]}"; do
    run_one "$slug" "$w" "$@" &
  done
  wait
  echo "<<< WAVE $slug done"
  python3 tools/approved/aggregate_sweep.py >/dev/null 2>&1 || true
}

stop_requested() {
  [[ -f "$STOP_FILE" ]]
}

round=1
while true; do
  stop_requested && break
  suffix=$(printf "x%02d" "$round")
  echo "=== EXPLORER ROUND $suffix ==="

  # Large-cap practical compounder basket: quality + momentum in liquid names.
  wave "momqlc-$suffix" python3 tools/approved/factor_rank.py --strategy mom-quality --top-n 12 --min-cap 10
  stop_requested && break

  # Cross-era adaptive composite with a higher cap floor for implementability.
  wave "adapt5-$suffix" python3 tools/approved/factor_rank.py --strategy adaptive-factor --top-n 10 --min-cap 5
  stop_requested && break

  # Shareholder-yield tilt with a tighter, more institution-friendly universe.
  wave "shy12-$suffix" python3 tools/approved/factor_rank.py --strategy shareholder-yield --top-n 12 --min-cap 5
  stop_requested && break

  # Price-driven sector timing with slower trend confirmation and cash defense.
  wave "sect12g-$suffix" python3 tools/approved/sector_momentum.py --sector-map "$SMAP" --top-n 5 --lookback-months 12 --sector-metric capweight --cash-guard
  stop_requested && break

  # Same concept, but diversified across sector constituents via mean scoring.
  wave "sect6mean-$suffix" python3 tools/approved/sector_momentum.py --sector-map "$SMAP" --top-n 5 --lookback-months 6 --sector-metric mean
  stop_requested && break

  # A more responsive defensive overlay than the original weak standalone trend filter.
  wave "trend150-$suffix" python3 tools/approved/trend_filter.py --top-n 15 --ma 150 --breadth 0.55
  stop_requested && break

  round=$((round + 1))
done

python3 tools/approved/aggregate_sweep.py >/dev/null 2>&1 || true
echo "AUTOPILOT FACTOR EXPLORER STOPPED"
