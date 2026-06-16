'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../../store/hooks'
import { money, percent, signedMoney, signedPercent, tone } from '../../../../shared/format'
import { prefillTradeFromRow } from './actions'

// Render the dense holdings table from the store. Clicking a symbol prefills the trade form via
// the prefill thunk so the position can be sold quickly.
export function Holdings() {
    const dispatch = useAppDispatch()
    const rows = useAppSelector((state) => state.account.view.rows)

    return (
        <section className="holdings">
            <div className="holdingsHead">
                <h2>Stocks / ETFs</h2>
                <span className="rowCount">{rows.length} positions</span>
            </div>

            {rows.length === 0 ? (
                <div className="emptyState">No holdings yet. Use the Trade panel to buy your first position.</div>
            ) : (
                <div className="tableScroll">
                    <table className="holdingsTable">
                        <thead>
                            <tr>
                                <th className="alignLeft" scope="col">Symbol</th>
                                <th scope="col">Quantity</th>
                                <th scope="col">Last Price</th>
                                <th scope="col">$ Chg</th>
                                <th scope="col">% Chg</th>
                                <th scope="col">Market Value</th>
                                <th scope="col">Day Chg $</th>
                                <th scope="col">Unit Cost</th>
                                <th scope="col">Total Cost</th>
                                <th scope="col">$ Gain/Loss</th>
                                <th scope="col">% Gain/Loss</th>
                                <th scope="col">% of Group</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.stockCode}>
                                    <th className="alignLeft symbol" scope="row">
                                        <button type="button" className="symbolButton" onClick={() => dispatch(prefillTradeFromRow(row))}>
                                            {row.stockCode}
                                        </button>
                                    </th>
                                    <td>{row.quantity}</td>
                                    <td>{money(row.currentPrice)}</td>
                                    <td className={tone(row.priceChange)}>{signedMoney(row.priceChange)}</td>
                                    <td className={tone(row.priceChange)}>{signedPercent(row.priceChangePercent)}</td>
                                    <td>{money(row.totalValue)}</td>
                                    <td className={tone(row.dayChangeValue)}>{signedMoney(row.dayChangeValue)}</td>
                                    <td>{money(row.averageCost)}</td>
                                    <td>{money(row.totalCostBasis)}</td>
                                    <td className={tone(row.totalGainLoss)}>{signedMoney(row.totalGainLoss)}</td>
                                    <td className={tone(row.totalGainLoss)}>{signedPercent(row.percentGainLoss)}</td>
                                    <td>{percent(row.percentOfGroup)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}
