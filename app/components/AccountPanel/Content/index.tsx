'use client'

import './style.css'
import { AccountHeader } from './AccountHeader'
import { Holdings } from './Holdings'

// Render the main content column: the account metrics header above the holdings table.
export function Content() {
    return (
        <main className="content">
            <AccountHeader />
            <Holdings />
        </main>
    )
}
