'use client'

import './style.css'
import { AccountHeader } from './AccountHeader'
import { Holdings } from './Holdings'

// Render the Positions tab: the portfolio metrics header above the holdings table.
export function Positions() {
    return (
        <div className="positionsTab">
            <AccountHeader />
            <Holdings />
        </div>
    )
}
