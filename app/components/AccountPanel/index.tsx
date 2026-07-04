'use client'

import { useEffect } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setPollPaused, setPollStatus } from '../../store/uiSlice'
import { loadAccountSnapshot, loadTradingCalendar, pollAccountData } from './actions'
import { loadHistory } from './Content/Histories/actions'
import { Sidebar } from './Sidebar'
import { Content } from './Content'
import { CalendarPopover } from './overlays/CalendarPopover'
import { DepositModal } from './overlays/DepositModal'
import { SessionModal } from './overlays/SessionModal'
import { StockInfoModal } from './overlays/StockInfoModal'

// How often to re-pull the live account data so holdings and notes track an in-progress
// simulation without a manual refresh.
const REFRESH_INTERVAL_MS = 5000

// How long the "ui updated" / "nothing to update" result lingers before the indicator returns to
// its waiting ("polling") state.
const POLL_RESULT_DISPLAY_MS = 1500

// Auto-pause polling after this long with no changes, so an idle tab stops hammering the API until
// the user resumes. Resuming starts a fresh idle window.
const POLL_IDLE_PAUSE_MS = 10 * 60 * 1000

// Render the full-width portfolio dashboard: a collapsible sidebar, the holdings content column,
// and the floating overlays. State lives in the Redux store, so children read what they need
// directly instead of receiving it through props.
export function AccountPanel() {
    const dispatch = useAppDispatch()
    const isSidebarCollapsed = useAppSelector((state) => state.ui.isSidebarCollapsed)
    const pollPaused = useAppSelector((state) => state.ui.pollPaused)

    // Hydrate the store with the shared account snapshot, trading calendar, and history on first render.
    // History is needed up front so the sidebar can show contributed principal regardless of active tab.
    useEffect(() => {
        void dispatch(loadAccountSnapshot())
        void dispatch(loadTradingCalendar())
        void dispatch(loadHistory())
    }, [dispatch])

    // Poll the account snapshot and history on an interval so the holdings table and notes rail stay
    // current while a simulation runs externally, driving the sidebar poll-status indicator through
    // its lifecycle: updating -> (updated | nothing to update) -> back to waiting until the next tick.
    // After POLL_IDLE_PAUSE_MS with no changes, polling auto-pauses until the user resumes; the effect
    // keys off pollPaused so resuming simply restarts it with a fresh idle window.
    useEffect(() => {
        if (pollPaused) {
            return
        }

        let cancelled = false
        let revertTimer: ReturnType<typeof setTimeout> | undefined
        // Reset the idle window each time polling (re)starts, so a resume grants another full window.
        let lastChangeAt = Date.now()

        const tick = async () => {
            dispatch(setPollStatus('updating'))
            const changed = await dispatch(pollAccountData())

            if (cancelled) {
                return
            }

            if (changed) {
                lastChangeAt = Date.now()
            } else if (Date.now() - lastChangeAt >= POLL_IDLE_PAUSE_MS) {
                // Long idle stretch: stop the loop and show the resume prompt.
                dispatch(setPollStatus('paused'))
                dispatch(setPollPaused(true))
                return
            }

            dispatch(setPollStatus(changed ? 'updated' : 'nochange'))
            revertTimer = setTimeout(() => {
                if (!cancelled) {
                    dispatch(setPollStatus('polling'))
                }
            }, POLL_RESULT_DISPLAY_MS)
        }

        const intervalId = setInterval(() => void tick(), REFRESH_INTERVAL_MS)

        return () => {
            cancelled = true
            clearInterval(intervalId)
            if (revertTimer) {
                clearTimeout(revertTimer)
            }
        }
    }, [dispatch, pollPaused])

    return (
        <>
            <div className={`appShell ${isSidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
                <Sidebar />
                <Content />
            </div>

            <CalendarPopover />
            <DepositModal />
            <SessionModal />
            <StockInfoModal />
        </>
    )
}
