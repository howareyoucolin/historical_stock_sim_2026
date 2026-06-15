'use client'

import { useEffect, useState } from 'react'

import { createEmptyDefaultUserAccountSessionView, type AccountStockTableRow, type AccountStockTableSummary, type DefaultUserAccountSessionView } from '../actions/account/view-model'
import { createDefaultAccountState } from '../actions/account/state'

const EMPTY_ACCOUNT_VIEW: DefaultUserAccountSessionView = createEmptyDefaultUserAccountSessionView(createDefaultAccountState())

interface AccountResponse {
    view: DefaultUserAccountSessionView
    sessionFile: string
}

// Format a numeric value as a fixed two-decimal currency-like string for the holdings UI.
function formatCurrency(value: number): string {
    return value.toFixed(2)
}

// Format a numeric value as a fixed two-decimal percentage string for the holdings UI.
function formatPercent(value: number): string {
    return `${value.toFixed(2)}%`
}

// Build the summary stats shown above the browser holdings table.
function buildSummaryItems(summary: AccountStockTableSummary, accountDate: string, cash: number): Array<{ label: string; value: string }> {
    return [
        { label: 'Date', value: accountDate },
        { label: 'Cash', value: formatCurrency(cash) },
        { label: 'Basis', value: formatCurrency(summary.principal) },
        { label: 'Value', value: formatCurrency(summary.totalCurrentValue) },
        { label: 'P/L', value: formatCurrency(summary.totalGainLoss) },
        { label: 'P/L%', value: formatPercent(summary.percentGainLoss) },
    ]
}

// Render the browser account controls and current shared account snapshot.
export function AccountPanel() {
    const [accountView, setAccountView] = useState<DefaultUserAccountSessionView>(EMPTY_ACCOUNT_VIEW)
    const [sessionFile, setSessionFile] = useState('user-sessions/default.json')
    const [statusMessage, setStatusMessage] = useState('Loading the shared account session...')
    const [isSaving, setIsSaving] = useState(false)

    // Fetch the shared account snapshot from the server-backed user session file.
    useEffect(() => {
        void loadAccountSnapshot()
    }, [])

    // Load the current account object and session file path from the shared API.
    async function loadAccountSnapshot(): Promise<void> {
        const response = await fetch('/api/account', { cache: 'no-store' })
        const payload = (await response.json()) as AccountResponse

        setAccountView(payload.view)
        setSessionFile(payload.sessionFile)
        setStatusMessage(`Loaded shared session from ${payload.sessionFile}.`)
    }

    // Reset the shared account session file to the default simulation shape.
    async function handleAccountInit(): Promise<void> {
        setIsSaving(true)

        try {
            const response = await fetch('/api/account', {
                method: 'POST',
            })
            const payload = (await response.json()) as AccountResponse

            setAccountView(payload.view)
            setSessionFile(payload.sessionFile)
            setStatusMessage(`Reset shared session in ${payload.sessionFile}.`)
        } finally {
            setIsSaving(false)
        }
    }

    const summaryItems = buildSummaryItems(accountView.summary, accountView.account.date, accountView.account.cash)

    return (
        <main className="page">
            <section className="card accountCard">
                <div className="cardHeader">
                    <div className="heroCopy">
                        <p className="eyebrow">StockSimulate2026</p>
                        <h1>Account View</h1>
                        <p className="copy">
                            Review the shared simulation account in <code>{sessionFile}</code>, including current holdings priced on the active simulation date.
                        </p>
                    </div>
                    <div className="actions">
                        <button className="primaryButton" type="button" onClick={() => void handleAccountInit()} disabled={isSaving}>
                            {isSaving ? 'Resetting...' : 'Account Init'}
                        </button>
                    </div>
                </div>
                <p className="status">{statusMessage}</p>
                <div className="storageMeta">
                    <span>Session file</span>
                    <code>{sessionFile}</code>
                </div>
                <div className="summaryGrid">
                    {summaryItems.map((item) => (
                        <article className="summaryCard" key={item.label}>
                            <span className="summaryLabel">{item.label}</span>
                            <strong className="summaryValue">{item.value}</strong>
                        </article>
                    ))}
                </div>
                <section className="holdingsSection">
                    <div className="sectionHeading">
                        <div>
                            <p className="sectionEyebrow">Holdings</p>
                            <h2>Tracked stocks</h2>
                        </div>
                        <span className="rowCount">{accountView.rows.length} symbols</span>
                    </div>
                    {accountView.rows.length === 0 ? (
                        <div className="emptyState">
                            No tracked stocks yet. Download price history and buy shares to populate the table.
                        </div>
                    ) : (
                        <div className="tableScroll">
                            <table className="holdingsTable">
                                <thead>
                                    <tr>
                                        <th scope="col">Stock</th>
                                        <th scope="col">Average cost</th>
                                        <th scope="col">Current price</th>
                                        <th scope="col">Quantity</th>
                                        <th scope="col">Total value</th>
                                        <th scope="col">Gain / loss</th>
                                        <th scope="col">Gain / loss %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accountView.rows.map((row: AccountStockTableRow) => (
                                        <tr key={row.stockCode}>
                                            <th scope="row">{row.stockCode}</th>
                                            <td>{formatCurrency(row.averageCost)}</td>
                                            <td>{formatCurrency(row.currentPrice)}</td>
                                            <td>{row.quantity}</td>
                                            <td>{formatCurrency(row.totalValue)}</td>
                                            <td>{formatCurrency(row.totalGainLoss)}</td>
                                            <td>{formatPercent(row.percentGainLoss)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </section>
        </main>
    )
}
