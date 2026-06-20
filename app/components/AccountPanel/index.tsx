'use client'

import { useEffect } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { loadAccountSnapshot, loadTradingCalendar } from './actions'
import { loadHistory } from './Content/Histories/actions'
import { Sidebar } from './Sidebar'
import { Content } from './Content'
import { CalendarPopover } from './overlays/CalendarPopover'
import { DepositModal } from './overlays/DepositModal'
import { ResetModal } from './overlays/ResetModal'

// How often to re-pull the live account data so holdings and notes track an in-progress
// simulation without a manual refresh.
const REFRESH_INTERVAL_MS = 5000

// Render the full-width portfolio dashboard: a collapsible sidebar, the holdings content column,
// and the floating overlays. State lives in the Redux store, so children read what they need
// directly instead of receiving it through props.
export function AccountPanel() {
    const dispatch = useAppDispatch()
    const isSidebarCollapsed = useAppSelector((state) => state.ui.isSidebarCollapsed)

    // Hydrate the store with the shared account snapshot, trading calendar, and history on first render.
    // History is needed up front so the sidebar can show contributed principal regardless of active tab.
    useEffect(() => {
        void dispatch(loadAccountSnapshot())
        void dispatch(loadTradingCalendar())
        void dispatch(loadHistory())
    }, [dispatch])

    // Poll the account snapshot and history on an interval so the holdings table and notes rail
    // stay current while a simulation runs externally. The calendar is static, so it is left out.
    useEffect(() => {
        const intervalId = setInterval(() => {
            void dispatch(loadAccountSnapshot())
            void dispatch(loadHistory())
        }, REFRESH_INTERVAL_MS)

        return () => clearInterval(intervalId)
    }, [dispatch])

    return (
        <>
            <div className={`appShell ${isSidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
                <Sidebar />
                <Content />
            </div>

            <CalendarPopover />
            <DepositModal />
            <ResetModal />
        </>
    )
}
