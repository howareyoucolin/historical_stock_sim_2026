#!/usr/bin/env bash
# Deterministic unattended strategy lab. Runs reproducible waves until STOP_AUTOPILOT appears.
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
  local S=$1 D="user-sessions/$1"
  curl -s -X POST "https://stock.369usa.com/insert.php?key=$KEY" \
    -F "report_json_file=@$D/report.json" \
    -F "account_json_file=@$D/account.json" \
    -F "history_log_file=@$D/history.log" \
    -F "meta_json_file=@$D/meta.json" \
    -F "values_log_file=@$D/values.log"
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
  if stop_requested; then
    echo "STOP_AUTOPILOT detected before round $round"
    break
  fi

  suffix=$(printf "r%02d" "$round")
  echo "=== AUTOPILOT ROUND $suffix ==="

  # Optimizer: deepen the current winner by adding a quality sleeve.
  wave "vmq-$suffix" python3 tools/approved/factor_rank.py --strategy value-mom-quality --top-n 10 --min-cap 2
  stop_requested && break

  wave "vmqwide-$suffix" python3 tools/approved/factor_rank.py --strategy value-mom-quality --top-n 15 --min-cap 5
  stop_requested && break

  # Optimizer: keep shareholder-yield but require trend confirmation.
  wave "shymom-$suffix" python3 tools/approved/factor_rank.py --strategy shareholder-momentum --top-n 10 --min-cap 2
  stop_requested && break

  wave "shymomfocus-$suffix" python3 tools/approved/factor_rank.py --strategy shareholder-momentum --top-n 8 --min-cap 5
  stop_requested && break

  # Explorer/optimizer hybrid: size + value + quality in the productive small-cap band.
  wave "smallvq-$suffix" python3 tools/approved/factor_rank.py --strategy small-cap-value-quality --top-n 10 --small-min 0.3 --small-max 8
  stop_requested && break

  wave "smallvqfocus-$suffix" python3 tools/approved/factor_rank.py --strategy small-cap-value-quality --top-n 8 --small-min 0.5 --small-max 6
  stop_requested && break

  # Alternate sector timing overlays around the earlier mild winner.
  wave "sectg-$suffix" python3 tools/approved/sector_momentum.py --sector-map "$SMAP" --top-n 5 --lookback-months 6 --sector-metric capweight --cash-guard
  stop_requested && break

  wave "sect3-$suffix" python3 tools/approved/sector_momentum.py --sector-map "$SMAP" --top-n 5 --lookback-months 3 --sector-metric capweight
  stop_requested && break

  round=$((round + 1))
done

python3 tools/approved/aggregate_sweep.py >/dev/null 2>&1 || true
echo "AUTOPILOT FACTOR LAB STOPPED"
