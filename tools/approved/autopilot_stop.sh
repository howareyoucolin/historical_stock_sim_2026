#!/usr/bin/env bash
#
# Cleanly stop the scoring autopilot and all its background processes.
#
# Order matters: stop the watchdog FIRST — its SIGTERM handler runs stop_worker, which tears down
# the supervisor (run_autopilot.py) and its in-flight children (codex exec / scoring_lab_v2.py)
# via the recorded process group. Then belt-and-suspenders TERM/KILL anything that ran without the
# watchdog (e.g. a bare `python3 run_autopilot.py --loop`). Finally bring the local Docker stack
# down (it's only local backend for backtest/publish; the live site is on DreamHost, unaffected).
#
# Usage:
#   ./autopilot_stop.sh          # stop autopilot processes + local Docker stack
#   npm run autopilot:stop       # (from simulator/)
#
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { echo "[autopilot:stop] $*"; }

# 1. Watchdog first (graceful): its trap -> stop_worker kills the supervisor + its children.
if pgrep -f 'tools/approved/watchdog.sh' >/dev/null 2>&1; then
  say "stopping watchdog (triggers clean worker teardown)…"
  pkill -TERM -f 'tools/approved/watchdog.sh' 2>/dev/null || true
  sleep 3
fi

# 2. Stop the background log pusher, a directly-run supervisor, and in-flight backtest/generation.
#    'codex exec' targets only the headless generator, never an interactive `codex` TUI session.
say "stopping pusher + supervisor + in-flight children…"
for pat in 'push_logs_loop.sh' 'run_autopilot.py' 'scoring_lab_v2.py' 'codex exec'; do
  pkill -TERM -f "$pat" 2>/dev/null || true
done
sleep 2

# 3. Force-kill anything that ignored SIGTERM.
for pat in 'tools/approved/watchdog.sh' 'push_logs_loop.sh' 'run_autopilot.py' 'scoring_lab_v2.py' 'codex exec'; do
  pkill -KILL -f "$pat" 2>/dev/null || true
done
rm -f /tmp/stockai_worker.pid

# 4. Log the stop marker and push it once so /logs.php reflects the Idle state (before Docker goes down).
python3 "${HERE}/alog.py" "autopilot stopped (autopilot:stop)" --level warn --source system >/dev/null 2>&1 || true
bash "${HERE}/../../../stock_report_website/deploy/push_logs.sh" >/dev/null 2>&1 || true

# 5. Report what (if anything) is still alive.
left="$(pgrep -fl 'tools/approved/watchdog.sh|run_autopilot.py|scoring_lab_v2.py' 2>/dev/null | wc -l | tr -d ' ')"
say "done — remaining autopilot processes: ${left}"
[[ "${left}" != "0" ]] && pgrep -fl 'tools/approved/watchdog.sh|run_autopilot.py|scoring_lab_v2.py' 2>/dev/null || true

# 6. Bring the local Docker backend down.
say "bringing Docker stack down…"
docker compose -f "${HERE}/../../../stock_report_website/docker-compose.yml" down || true

say "note: the push_logs.sh cron (if you added one) is a 1-min job, not a process — remove its crontab line to stop log pushes."
