#!/usr/bin/env bash
# CONTINUE the factor sweep (handoff from the prior agent). Waves 1-3 (momq, valmom, earn) and
# low-vol 2006 are already uploaded. This finishes the rest:
#   1) re-upload the 3 low-vol windows that completed on disk but whose upload returned empty
#   2) re-run the hung low-vol 2021 window
#   3) run the remaining strategies: shareholder-yield, small-cap-quality, sector-momentum
#      (cap-weighted), trend-filter — across the DEFAULT 5-YEAR WINDOWS, one preserved session
#      each, 5 windows per wave in PARALLEL, uploading each report when it finishes.
# Requires: Node 22 (nvm), market-data API on localhost:8700. Panel + sector map are cached beside
# this script (stable, git-ignored). Each run is timeout-guarded (low-vol can be slow/deadlock-prone).
set -uo pipefail
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null 2>&1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"
PANEL=tools/unapproved/price_panel.json
SMAP=tools/approved/sector_map.json
OUT=tools/unapproved/sweep_out; mkdir -p "$OUT"
KEY=$(grep '^SECRET_KEY=' .env | cut -d= -f2- | tr -d '\r\n')
WINDOWS=(2001-07-01 2006-07-01 2011-07-01 2016-07-01 2021-07-01)

upload() {  # upload a preserved session folder's five files to production
  local S=$1 D="user-sessions/$1"
  curl -s -X POST "https://stock.369usa.com/insert.php?key=$KEY" \
    -F "report_json_file=@$D/report.json" -F "account_json_file=@$D/account.json" \
    -F "history_log_file=@$D/history.log" -F "meta_json_file=@$D/meta.json" \
    -F "values_log_file=@$D/values.log"
}

run_one() {  # run_one <slug> <start> <cmd...>
  local SLUG=$1 START=$2; shift 2
  local S="${SLUG}-${START:0:4}"
  {
    echo "======== $S ($START) ========"
    timeout 5400 "$@" --start "$START" --years 5 --panel "$PANEL" --session "$S" \
      --strategy-version "$S" --ledger "$OUT/${S}.jsonl"
    echo "-- uploading $S --"; upload "$S"; echo; echo "DONE $S"
  } > "$OUT/${S}.log" 2>&1
}

wave() {  # one strategy, 5 windows in parallel
  local SLUG=$1; shift
  echo ">>> WAVE $SLUG"
  for W in "${WINDOWS[@]}"; do run_one "$SLUG" "$W" "$@" & done
  wait
  echo "<<< WAVE $SLUG done"
}

# 1) re-upload the low-vol windows that finished but did not upload
for S in lowvol-2001 lowvol-2011 lowvol-2016; do echo "re-upload $S:"; upload "$S"; echo; done
# 2) finish low-vol: re-run the hung 2021 window (account init resets its own folder)
echo ">>> finishing lowvol-2021"
run_one lowvol 2021-07-01 python3 tools/approved/factor_rank.py --strategy low-vol --top-n 10
echo "<<< lowvol-2021 done"
# 3) remaining strategy waves
FR="python3 tools/approved/factor_rank.py"
wave shy    $FR --strategy shareholder-yield --top-n 10
wave smallq $FR --strategy small-cap-quality --top-n 10
wave sectcw python3 tools/approved/sector_momentum.py --sector-map "$SMAP" --top-n 5 --lookback-months 6 --sector-metric capweight
wave trend  python3 tools/approved/trend_filter.py --top-n 15 --ma 200 --breadth 0.5
echo "ALL CONTINUE DONE"
