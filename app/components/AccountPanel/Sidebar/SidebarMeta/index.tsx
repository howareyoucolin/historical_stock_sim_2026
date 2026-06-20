'use client'

import './style.css'
import { useAppSelector } from '../../../../store/hooks'
import { money, signedMoney, tone } from '../../../shared/format'

// Sum every recorded cash deposit (net of withdrawals) to get the capital actually contributed.
// Deposit lines look like "<ts> DEPOSIT cash=+200000.00 sim=2016-01-04"; the signed cash token is summed.
function sumDeposits(entries: string[]): number {
    let total = 0

    for (const line of entries) {
        if (!line.includes(' DEPOSIT ')) {
            continue
        }

        const token = line.split(' ').find((part) => part.startsWith('cash='))
        const amount = token ? Number.parseFloat(token.slice('cash='.length)) : Number.NaN

        if (!Number.isNaN(amount)) {
            total += amount
        }
    }

    return total
}

// Render the at-a-glance account figures (simulation date, principal, current total, total gain/loss).
// Principal is the contributed capital (sum of deposits); total gain/loss measures the whole account
// (cash + holdings) against that principal, so it captures realized P/L and dividends, not just open positions.
export function SidebarMeta() {
    const { account, summary } = useAppSelector((state) => state.account.view)
    const historyEntries = useAppSelector((state) => state.account.historyEntries)

    const principal = sumDeposits(historyEntries)
    const currentTotal = account.cash + summary.totalCurrentValue
    const totalGainLoss = currentTotal - principal

    return (
        <div className="sidebarMeta">
            <div className="metaRow">
                <span>Simulation date</span>
                <strong>{account.date}</strong>
            </div>
            <div className="metaRow">
                <span>Principal</span>
                <strong>{money(principal)}</strong>
            </div>
            <div className="metaRow">
                <span>Current total</span>
                <strong>{money(currentTotal)}</strong>
            </div>
            <div className="metaRow">
                <span>Total gain/loss</span>
                <strong className={tone(totalGainLoss)}>{signedMoney(totalGainLoss)}</strong>
            </div>
        </div>
    )
}
