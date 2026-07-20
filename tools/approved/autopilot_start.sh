#!/usr/bin/env bash
#
# Start the scoring autopilot as one self-contained unit:
#   1. bring the local Docker backend up
#   2. start the log pusher in the BACKGROUND (mirrors local logs -> prod /logs.php every minute,
#      so the remote page stays live without a separate cron)
#   3. run the watchdog in the FOREGROUND (it manages run_autopilot.py and restarts it on stall)
#
# Stop everything (including the pusher) with `npm run autopilot:stop`. Steer a run with
# `npm run autopilot:start --message="…"` (passed through as AUTOPILOT_MESSAGE).
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIM_ROOT="$(cd "${HERE}/../.." && pwd)"
WEBROOT="$(cd "${SIM_ROOT}/../stock_report_website" && pwd)"

echo "→ bringing up Docker backend…"
docker compose -f "${WEBROOT}/docker-compose.yml" up -d

echo "→ starting log pusher (prod /logs.php stays live)…"
nohup bash "${WEBROOT}/deploy/push_logs_loop.sh" >/dev/null 2>&1 &
echo "  pusher pid $!"

echo "→ starting watchdog + supervisor…"
cd "${SIM_ROOT}"
export AUTOPILOT_MESSAGE="${AUTOPILOT_MESSAGE:-}"
export WORKER_CMD='python3 tools/approved/run_autopilot.py --loop --generator mutate --gen-timeout 900 --bt-timeout 300'
export STALE_SECS="${STALE_SECS:-1500}"
exec bash tools/approved/watchdog.sh
