'use client'

import './style.css'
import { Fragment, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../../../../store/hooks'
import { money, signedMoney, signedPercent, tone } from '../../../../shared/format'
import type { AccountStockTableRow } from '../../../../../actions/account/view-model'
import { getVisibleHoldingsColumns } from './columns'
import { prefillTradeFromRow } from './actions'

// Render the per-lot breakdown shown when a holding is expanded, as an inset table that mirrors
// the parent columns but only carries the figures that differ between purchase batches. The
// colSpan must cover the expand and symbol columns plus every visible data column so the inset
// table lines up under the symbol row.
function LotDetail({ row, columnCount }: { row: AccountStockTableRow; columnCount: number }) {
    return (
        <tr className="lotDetailRow">
            <td className="lotDetailCell" colSpan={columnCount}>
                <table className="lotTable">
                    <thead>
                        <tr>
                            <th className="alignLeft" scope="col">Lot Purchase Date</th>
                            <th scope="col">Quantity</th>
                            <th scope="col">Market Value</th>
                            <th scope="col">Unit Cost</th>
                            <th scope="col">Total Cost</th>
                            <th scope="col">$ Gain/Loss</th>
                            <th scope="col">% Gain/Loss</th>
                        </tr>
                    </thead>
                    <tbody>
                        {row.lots.map((lot, index) => (
                            <tr key={`${lot.purchaseDate}-${index}`}>
                                <td className="alignLeft">{lot.purchaseDate}</td>
                                <td>{lot.quantity}</td>
                                <td>{money(lot.marketValue)}</td>
                                <td>{money(lot.unitCost)}</td>
                                <td>{money(lot.totalCost)}</td>
                                <td className={tone(lot.gainLoss)}>{signedMoney(lot.gainLoss)}</td>
                                <td className={tone(lot.gainLoss)}>{signedPercent(lot.percentGainLoss)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </td>
        </tr>
    )
}

// Render the dense holdings table from the store. Each symbol can expand to reveal its individual
// purchase lots, and clicking a symbol prefills the trade form via the prefill thunk.
export function Holdings() {
    const dispatch = useAppDispatch()
    const rows = useAppSelector((state) => state.account.view.rows)

    // Data columns are driven by the column config so they can be toggled on/off in one place.
    const columns = getVisibleHoldingsColumns()
    // colSpan for the inset lot panel: the expand and symbol columns plus the visible data columns.
    const lotColumnCount = columns.length + 2

    // Which symbols are expanded is transient, view-only state, so it stays local per component rules.
    const [expanded, setExpanded] = useState<Set<string>>(new Set())

    // Toggle the expanded lot panel for a single symbol without disturbing the others.
    function toggleExpanded(stockCode: string) {
        setExpanded((previous) => {
            const next = new Set(previous)
            next.has(stockCode) ? next.delete(stockCode) : next.add(stockCode)
            return next
        })
    }

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
                                <th className="expandCol" scope="col"><span className="srOnly">Expand</span></th>
                                <th className="alignLeft" scope="col">Symbol</th>
                                {columns.map((column) => (
                                    <th key={column.key} scope="col">{column.header}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const isExpanded = expanded.has(row.stockCode)

                                return (
                                    <Fragment key={row.stockCode}>
                                        <tr>
                                            <td className="expandCol">
                                                <button
                                                    type="button"
                                                    className="expandButton"
                                                    aria-expanded={isExpanded}
                                                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.stockCode} lots`}
                                                    onClick={() => toggleExpanded(row.stockCode)}
                                                >
                                                    <span className={`chevron${isExpanded ? ' open' : ''}`}>›</span>
                                                </button>
                                            </td>
                                            <th className="alignLeft symbol" scope="row">
                                                <button type="button" className="symbolButton" onClick={() => dispatch(prefillTradeFromRow(row))}>
                                                    {row.stockCode}
                                                </button>
                                            </th>
                                            {columns.map((column) => (
                                                <td key={column.key} className={column.cellClassName?.(row)}>
                                                    {column.render(row)}
                                                </td>
                                            ))}
                                        </tr>
                                        {isExpanded && <LotDetail row={row} columnCount={lotColumnCount} />}
                                    </Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}
