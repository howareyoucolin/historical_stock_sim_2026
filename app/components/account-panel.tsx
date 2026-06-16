'use client'

import { useEffect, useState } from 'react'

import { createEmptyDefaultUserAccountSessionView, type AccountStockTableRow, type DefaultUserAccountSessionView } from '../actions/account/view-model'
import { createDefaultAccountState } from '../actions/account/state'

const EMPTY_ACCOUNT_VIEW: DefaultUserAccountSessionView = createEmptyDefaultUserAccountSessionView(createDefaultAccountState())

interface AccountResponse {
    view: DefaultUserAccountSessionView
    sessionFile: string
    message?: string
    error?: string
}

// Format a number with thousands separators and two decimals for monetary display.
function money(value: number): string {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Format a signed monetary value so gains and losses read clearly in the table.
function signedMoney(value: number): string {
    return `${value >= 0 ? '+' : '-'}${money(Math.abs(value))}`
}

// Format a signed percentage value for change columns.
function signedPercent(value: number): string {
    return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`
}

// Format a plain percentage value (e.g. share of group).
function percent(value: number): string {
    return `${value.toFixed(2)}%`
}

// Map a numeric change to a CSS tone class so positive and negative values are colored.
function tone(value: number): string {
    if (value > 0) {
        return 'pos'
    }

    if (value < 0) {
        return 'neg'
    }

    return ''
}

// Render the full-width portfolio dashboard with a trading sidebar and holdings table.
export function AccountPanel() {
    const [accountView, setAccountView] = useState<DefaultUserAccountSessionView>(EMPTY_ACCOUNT_VIEW)
    const [statusMessage, setStatusMessage] = useState('Loading the shared account session...')
    const [symbol, setSymbol] = useState('')
    const [quantity, setQuantity] = useState('')
    const [isBusy, setIsBusy] = useState(false)
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
    const [isResetModalOpen, setIsResetModalOpen] = useState(false)

    useEffect(() => {
        void loadAccountSnapshot()
    }, [])

    // Load the current account snapshot from the shared API.
    async function loadAccountSnapshot(): Promise<void> {
        const response = await fetch('/api/account', { cache: 'no-store' })
        const payload = (await response.json()) as AccountResponse

        setAccountView(payload.view)
        setStatusMessage('Loaded shared account session.')
    }

    // Submit a buy or sell order for the symbol and quantity entered in the sidebar.
    async function submitTrade(action: 'buy' | 'sell'): Promise<void> {
        const normalizedSymbol = symbol.trim().toUpperCase()
        const parsedQuantity = Number(quantity)

        if (normalizedSymbol === '') {
            setStatusMessage('Enter a stock symbol to trade.')
            return
        }

        if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
            setStatusMessage('Quantity must be a positive whole number.')
            return
        }

        setIsBusy(true)

        try {
            const response = await fetch('/api/account/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, stockCode: normalizedSymbol, quantity: parsedQuantity }),
            })
            const payload = (await response.json()) as AccountResponse

            if (!response.ok || payload.error) {
                setStatusMessage(payload.error ?? 'Trade failed.')
                return
            }

            setAccountView(payload.view)
            setStatusMessage(payload.message ?? 'Trade complete.')
            setQuantity('')
        } finally {
            setIsBusy(false)
        }
    }

    // Reset the shared account session file to the default simulation shape.
    async function resetAccount(): Promise<void> {
        setIsBusy(true)

        try {
            const response = await fetch('/api/account', { method: 'POST' })
            const payload = (await response.json()) as AccountResponse

            setAccountView(payload.view)
            setStatusMessage('Account reset to the default starting state.')
        } finally {
            setIsBusy(false)
        }
    }

    // Prefill the trade form with a held position so it can be quickly sold.
    function prefillFromRow(row: AccountStockTableRow): void {
        setSymbol(row.stockCode)
        setQuantity(String(row.quantity))
    }

    const { account, rows, summary } = accountView
    const headerMetrics = [
        { label: 'Cash', value: money(account.cash), tone: '' },
        { label: 'Total Market Value', value: money(summary.totalCurrentValue), tone: '' },
        { label: 'Day Change', value: `${signedMoney(summary.totalDayChange)} (${signedPercent(summary.dayChangePercent)})`, tone: tone(summary.totalDayChange) },
        { label: 'Unrealized Gain/Loss', value: `${signedMoney(summary.totalGainLoss)} (${signedPercent(summary.percentGainLoss)})`, tone: tone(summary.totalGainLoss) },
    ]

    return (
        <>
        <div className={`appShell ${isSidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
            <aside className="sidebar">
                <button
                    className="collapseToggle"
                    type="button"
                    onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
                    aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {isSidebarCollapsed ? '»' : '« Collapse'}
                </button>
                {!isSidebarCollapsed && (
                <div className="sidebarBody">
                <div className="brand">
                    <p className="eyebrow">StockSimulate 2026</p>
                    <h1>Portfolio</h1>
                </div>

                <section className="tradeBox">
                    <h2>Trade</h2>
                    <label className="field">
                        <span>Symbol</span>
                        <input
                            value={symbol}
                            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                            placeholder="AAPL"
                            autoComplete="off"
                        />
                    </label>
                    <label className="field">
                        <span>Quantity</span>
                        <input value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="10" inputMode="numeric" />
                    </label>
                    <div className="tradeButtons">
                        <button className="buyButton" type="button" onClick={() => void submitTrade('buy')} disabled={isBusy}>
                            Buy
                        </button>
                        <button className="sellButton" type="button" onClick={() => void submitTrade('sell')} disabled={isBusy}>
                            Sell
                        </button>
                    </div>
                </section>

                <div className="sidebarMeta">
                    <div className="metaRow">
                        <span>Simulation date</span>
                        <strong>{account.date}</strong>
                    </div>
                    <div className="metaRow">
                        <span>Cash</span>
                        <strong>{money(account.cash)}</strong>
                    </div>
                </div>

                <p className="status">{statusMessage}</p>

                <button className="resetButton" type="button" onClick={() => setIsResetModalOpen(true)} disabled={isBusy}>
                    Reset
                </button>
                </div>
                )}
            </aside>

            <main className="content">
                <header className="accountHeader">
                    {headerMetrics.map((metric) => (
                        <article className="metric" key={metric.label}>
                            <span className="metricLabel">{metric.label}</span>
                            <strong className={`metricValue ${metric.tone}`}>{metric.value}</strong>
                        </article>
                    ))}
                </header>

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
                                        <th scope="col">Purchase Date</th>
                                        <th scope="col">% of Group</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => (
                                        <tr key={row.stockCode}>
                                            <th className="alignLeft symbol" scope="row">
                                                <button type="button" className="symbolButton" onClick={() => prefillFromRow(row)}>
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
                                            <td>{row.purchaseDate}</td>
                                            <td>{percent(row.percentOfGroup)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </main>
        </div>

        {isResetModalOpen && (
            <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="resetTitle">
                <div className="modalCard">
                    <h3 id="resetTitle">Reset account?</h3>
                    <p>This clears all holdings and cash and restores the default starting state. This cannot be undone.</p>
                    <div className="modalActions">
                        <button type="button" className="modalCancel" onClick={() => setIsResetModalOpen(false)} disabled={isBusy}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="modalConfirm"
                            onClick={() => {
                                setIsResetModalOpen(false)
                                void resetAccount()
                            }}
                            disabled={isBusy}
                        >
                            Reset account
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    )
}
