'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { setActiveTab, type ContentTab } from '../../../../store/uiSlice'
import { writeTabToUrl } from '../tabUrl'

// The content tabs in display order, paired with their labels.
const TABS: Array<{ id: ContentTab; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'positions', label: 'Positions' },
    { id: 'histories', label: 'Histories' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'report', label: 'Report' },
]

// Render the tab bar above the content column and switch the active tab through the ui slice.
export function Tabs() {
    const dispatch = useAppDispatch()
    const activeTab = useAppSelector((state) => state.ui.activeTab)

    return (
        <nav className="contentTabs" role="tablist" aria-label="Portfolio views">
            {TABS.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`contentTab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => {
                        dispatch(setActiveTab(tab.id))
                        writeTabToUrl(tab.id)
                    }}
                >
                    {tab.label}
                </button>
            ))}
        </nav>
    )
}
