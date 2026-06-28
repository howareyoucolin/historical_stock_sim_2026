'use client'

import { useEffect } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { setActiveTab } from '../../../store/uiSlice'
import { readTabFromUrl, writeTabToUrl } from './tabUrl'
import { Tabs } from './Tabs'
import { Summary } from './Summary'
import { Positions } from './Positions'
import { Histories } from './Histories'
import { Report } from './Report'
import { Analysis } from './Analysis'

// Render the main content column: the tab bar above the panel for the active tab. Inactive panels
// unmount, so tab-specific data (e.g. histories) reloads each time its tab is opened.
export function Content() {
    const dispatch = useAppDispatch()
    const activeTab = useAppSelector((state) => state.ui.activeTab)

    // On first load, restore the tab from the URL (so a refresh stays on the same tab); if the URL
    // has no tab yet, seed it with the current default so the address bar reflects the view.
    useEffect(() => {
        const urlTab = readTabFromUrl()

        if (urlTab) {
            dispatch(setActiveTab(urlTab))
        } else {
            writeTabToUrl(activeTab)
        }
        // Run once on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <main className="content">
            <Tabs />

            {activeTab === 'summary' && <Summary />}
            {activeTab === 'positions' && <Positions />}
            {activeTab === 'histories' && <Histories />}
            {activeTab === 'report' && <Report />}
            {activeTab === 'analysis' && <Analysis />}
        </main>
    )
}
