'use client'

import './style.css'
import { useAppSelector } from '../../../../store/hooks'
import { money } from '../../../shared/format'

// Render the at-a-glance account figures (simulation date, principal, current total) from the store.
export function SidebarMeta() {
    const { account, summary } = useAppSelector((state) => state.account.view)

    return (
        <div className="sidebarMeta">
            <div className="metaRow">
                <span>Simulation date</span>
                <strong>{account.date}</strong>
            </div>
            <div className="metaRow">
                <span>Principal</span>
                <strong>{money(account.cash + summary.principal)}</strong>
            </div>
            <div className="metaRow">
                <span>Current total</span>
                <strong>{money(account.cash + summary.totalCurrentValue)}</strong>
            </div>
        </div>
    )
}
