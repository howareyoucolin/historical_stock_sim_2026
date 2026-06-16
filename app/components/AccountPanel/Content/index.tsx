'use client'

import './style.css'
import { useAppSelector } from '../../../store/hooks'
import { Tabs } from './Tabs'
import { Summary } from './Summary'
import { Positions } from './Positions'
import { Histories } from './Histories'
import { Analysis } from './Analysis'

// Render the main content column: the tab bar above the panel for the active tab. Inactive panels
// unmount, so tab-specific data (e.g. histories) reloads each time its tab is opened.
export function Content() {
    const activeTab = useAppSelector((state) => state.ui.activeTab)

    return (
        <main className="content">
            <Tabs />

            {activeTab === 'summary' && <Summary />}
            {activeTab === 'positions' && <Positions />}
            {activeTab === 'histories' && <Histories />}
            {activeTab === 'analysis' && <Analysis />}
        </main>
    )
}
