'use client'

import { useEffect } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { loadAccountSnapshot, loadTradingCalendar } from './actions'
import { Sidebar } from './Sidebar'
import { Content } from './Content'
import { CalendarPopover } from './overlays/CalendarPopover'
import { DepositModal } from './overlays/DepositModal'
import { ResetModal } from './overlays/ResetModal'

// Render the full-width portfolio dashboard: a collapsible sidebar, the holdings content column,
// and the floating overlays. State lives in the Redux store, so children read what they need
// directly instead of receiving it through props.
export function AccountPanel() {
    const dispatch = useAppDispatch()
    const isSidebarCollapsed = useAppSelector((state) => state.ui.isSidebarCollapsed)

    // Hydrate the store with the shared account snapshot and trading calendar on first render.
    useEffect(() => {
        void dispatch(loadAccountSnapshot())
        void dispatch(loadTradingCalendar())
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
