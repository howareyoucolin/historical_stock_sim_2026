'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { toggleSidebar } from '../../../store/uiSlice'
import { TradeBox } from './TradeBox'
import { TimeTravel } from './TimeTravel'
import { SidebarMeta } from './SidebarMeta'
import { ResetControl } from './ResetControl'
import { PollStatus } from './PollStatus'

// Render the collapsible trading sidebar: brand, trade box, time-travel controls, account meta,
// the live status line, and the reset control. All data is pulled from the store by each child.
export function Sidebar() {
    const dispatch = useAppDispatch()
    const isSidebarCollapsed = useAppSelector((state) => state.ui.isSidebarCollapsed)
    const status = useAppSelector((state) => state.account.status)

    return (
        <aside className="sidebar">
            <button
                className="collapseToggle"
                type="button"
                onClick={() => dispatch(toggleSidebar())}
                aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                {isSidebarCollapsed ? '»' : '« Collapse'}
            </button>

            {!isSidebarCollapsed && (
                <div className="sidebarBody">
                    <div className="brand">
                        <p className="eyebrow">StockSimulate 2026</p>
                        <h1>Portfolio</h1>
                    </div>

                    <TradeBox />
                    <TimeTravel />
                    <SidebarMeta />

                    <p className="status">{status}</p>

                    {/* Footer pinned to the bottom: reset on the left, refresh status on the right. */}
                    <div className="sidebarFooter">
                        <ResetControl />
                        <PollStatus />
                    </div>
                </div>
            )}
        </aside>
    )
}
