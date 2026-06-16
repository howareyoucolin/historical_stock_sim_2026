'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../../store/hooks'
import { openDepositModal } from '../../../../../store/uiSlice'
import { money, signedMoney, signedPercent, tone } from '../../../../shared/format'

// Render the portfolio metric cards (cash, market value, day change, gain/loss) from the store.
// The cash card carries the Deposit button, which opens the deposit modal.
export function AccountHeader() {
    const dispatch = useAppDispatch()
    const { account, summary } = useAppSelector((state) => state.account.view)
    const isBusy = useAppSelector((state) => state.account.isBusy)

    const headerMetrics = [
        { label: 'Cash', value: money(account.cash), tone: '' },
        { label: 'Total Market Value', value: money(summary.totalCurrentValue), tone: '' },
        {
            label: 'Day Change',
            value: `${signedMoney(summary.totalDayChange)} (${signedPercent(summary.dayChangePercent)})`,
            tone: tone(summary.totalDayChange),
        },
        {
            label: 'Unrealized Gain/Loss',
            value: `${signedMoney(summary.totalGainLoss)} (${signedPercent(summary.percentGainLoss)})`,
            tone: tone(summary.totalGainLoss),
        },
    ]

    return (
        <header className="accountHeader">
            {headerMetrics.map((metric) => (
                <article className="metric" key={metric.label}>
                    <span className="metricLabel">{metric.label}</span>
                    {metric.label === 'Cash' ? (
                        <div className="metricValueRow">
                            <strong className={`metricValue ${metric.tone}`}>{metric.value}</strong>
                            <button className="depositButton" type="button" onClick={() => dispatch(openDepositModal())} disabled={isBusy}>
                                Deposit
                            </button>
                        </div>
                    ) : (
                        <strong className={`metricValue ${metric.tone}`}>{metric.value}</strong>
                    )}
                </article>
            ))}
        </header>
    )
}
