'use client'

import './style.css'
import { AccountHeader } from './AccountHeader'
import { Holdings } from './Holdings'
import { NotesPanel } from './NotesPanel'

// Render the Positions tab: the portfolio metrics header above the holdings table, with a
// fixed-width notes rail beside the table.
export function Positions() {
    return (
        <div className="positionsTab">
            <AccountHeader />
            <div className="positionsBody">
                <Holdings />
                <NotesPanel />
            </div>
        </div>
    )
}
