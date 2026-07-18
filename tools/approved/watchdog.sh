#!/usr/bin/env bash
#
# Local watchdog for the scoring automation. "Progress" = a fresh row in the LOCAL automation_log
# table (written via tools/approved/alog.py) — the same signal shown remotely on /logs.php. Must
# run on the machine that runs the automation.
#
# Two modes, chosen by whether WORKER_CMD is set:
#
#   ALERT-ONLY (no WORKER_CMD) — for when you drive the loop interactively (e.g. talking to Codex).
#     A shell script cannot relaunch a chat, so on a stall it only ALERTS: it writes a loud STALE
#     line (visible on /logs.php) and runs NOTIFY_CMD if you set one. You then go nudge the agent.
#
#   MANAGED (WORKER_CMD set) — for a headless, relaunchable loop (a mechanical supervisor, or a
#     non-interactive agent invocation). It starts the worker and restarts it if the process dies
#     or no new log row appears for STALE_SECS. Safe to relaunch because the loop is resumable
#     (the prod feed is the system of record; experiments are keyed by test_key).
#
# Usage:
#   ./watchdog.sh                                   # alert-only
#   NOTIFY_CMD='osascript -e "display notification \"automation stalled\" with title \"StockAI\""' ./watchdog.sh
#   WORKER_CMD='python3 /path/to/run_supervisor.py' ./watchdog.sh   # managed (auto-restart)
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WORKER_CMD="${WORKER_CMD:-}"           # set => managed/auto-restart; unset => alert-only
NOTIFY_CMD="${NOTIFY_CMD:-}"           # optional shell command run once when a stall is detected
STALE_SECS="${STALE_SECS:-300}"        # stall threshold (default 5 min)
CHECK_INTERVAL="${CHECK_INTERVAL:-60}" # how often to check
GRACE_SECS="${GRACE_SECS:-10}"         # wait after SIGTERM before SIGKILL (managed mode)
PIDFILE="${PIDFILE:-/tmp/stockai_worker.pid}"

DB_CONTAINER="${STOCKAI_DB_CONTAINER:-stock_report_mysql}"
DB_NAME="${STOCKAI_DB_NAME:-stock_report}"
DB_USER="${STOCKAI_DB_USER:-stock_user}"
DB_PASS="${STOCKAI_DB_PASS:-stock_pass}"

# Log the watchdog's own actions into the same stream the operator watches.
wlog() { python3 "${HERE}/alog.py" "$1" --level "${2:-info}" --source watchdog >/dev/null 2>&1 || true; }

# Seconds since the newest automation_log row (empty if the table/row doesn't exist yet).
log_age_secs() {
  docker exec -i "${DB_CONTAINER}" mysql -u"${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" -N -e \
    "SELECT TIMESTAMPDIFF(SECOND, MAX(ts), NOW()) FROM automation_log" 2>/dev/null
}

notify() { [[ -n "${NOTIFY_CMD}" ]] && bash -c "${NOTIFY_CMD}" >/dev/null 2>&1 || true; }

# ---- managed-mode worker control ----
worker_alive() {
  [[ -f "${PIDFILE}" ]] || return 1
  local pid; pid="$(cat "${PIDFILE}" 2>/dev/null)"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}
start_worker() {
  bash -c "${WORKER_CMD}" &
  echo $! > "${PIDFILE}"
  wlog "watchdog: started worker (pid $(cat "${PIDFILE}"))" info
}
stop_worker() {
  [[ -f "${PIDFILE}" ]] || return 0
  local pid; pid="$(cat "${PIDFILE}" 2>/dev/null)"
  [[ -n "${pid}" ]] || return 0
  pkill -TERM -P "${pid}" 2>/dev/null || true
  kill -TERM "${pid}" 2>/dev/null || true
  for _ in $(seq 1 "${GRACE_SECS}"); do kill -0 "${pid}" 2>/dev/null || break; sleep 1; done
  pkill -KILL -P "${pid}" 2>/dev/null || true
  kill -KILL "${pid}" 2>/dev/null || true
  rm -f "${PIDFILE}"
}
restart_worker() { wlog "watchdog: restarting worker — $1" warn; notify; stop_worker; start_worker; }

# Exit cleanly on signals (a non-exiting trap would resume the loop); EXIT trap tears down once.
cleanup() { [[ -n "${WORKER_CMD}" ]] && stop_worker; wlog "watchdog: exiting" info; }
trap 'exit 0' INT TERM
trap cleanup EXIT

if [[ -n "${WORKER_CMD}" ]]; then
  # ---------- MANAGED MODE ----------
  wlog "watchdog: online, MANAGED (stale>${STALE_SECS}s, check ${CHECK_INTERVAL}s)" info
  start_worker
  while true; do
    sleep "${CHECK_INTERVAL}"
    if ! worker_alive; then restart_worker "worker process not running"; continue; fi
    age="$(log_age_secs)"
    if [[ -n "${age}" && "${age}" != "NULL" && "${age}" -gt "${STALE_SECS}" ]]; then
      restart_worker "no new log for ${age}s (> ${STALE_SECS}s)"
    fi
  done
else
  # ---------- ALERT-ONLY MODE ----------
  wlog "watchdog: online, ALERT-ONLY (alert if no new log for ${STALE_SECS}s)" info
  alerted=0
  while true; do
    sleep "${CHECK_INTERVAL}"
    age="$(log_age_secs)"
    if [[ -n "${age}" && "${age}" != "NULL" && "${age}" -gt "${STALE_SECS}" ]]; then
      if [[ "${alerted}" -eq 0 ]]; then
        wlog "watchdog: STALE — no new log for ${age}s (> ${STALE_SECS}s); automation may be stuck" error
        notify
        alerted=1
      fi
    else
      alerted=0   # recovered; re-arm the alert
    fi
  done
fi
