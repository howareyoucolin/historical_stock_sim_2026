'use client'

import { useEffect, useState } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { loadHistory } from './actions'

interface HistoryRow {
    date: string
    action: string
    symbol: string
    quantity: string
    price: string
    acquired: string
    term: string
    cash: string
    note: string
}

type HistoryTypeSelection = Record<string, boolean>

// Parse one raw log line ("<iso> <ACTION> <key=value>...") into table columns. The real timestamp
// is dropped in favor of the simulated date carried in the `sim` token. The optional note is JSON-
// quoted and always last, so it is split off and parsed as a unit before the rest is tokenized — that
// keeps a multi-word note (which contains spaces) from being mangled by the space split.
function parseHistoryLine(line: string): HistoryRow {
    const noteMarker = ' note='
    const markerIndex = line.indexOf(noteMarker)
    const head = markerIndex === -1 ? line : line.slice(0, markerIndex)

    let note = ''

    if (markerIndex !== -1) {
        const rawNote = line.slice(markerIndex + noteMarker.length)

        try {
            note = JSON.parse(rawNote)
        } catch {
            note = rawNote
        }
    }

    const [, action = '', ...rest] = head.split(' ')
    const fields: Record<string, string> = {}

    for (const token of rest) {
        const separatorIndex = token.indexOf('=')

        if (separatorIndex !== -1) {
            fields[token.slice(0, separatorIndex)] = token.slice(separatorIndex + 1)
        }
    }

    return {
        date: fields.sim ?? '',
        action,
        symbol: fields.stock ?? '',
        quantity: fields.qty ?? '',
        price: fields.price ?? '',
        acquired: fields.acquired ?? '',
        term: fields.term ?? '',
        cash: fields.cash ?? '',
        note,
    }
}

// Keep the available history action types in first-seen order so the filters stay stable and match
// the rows currently loaded into the tab.
function listHistoryTypes(rows: HistoryRow[]): string[] {
    const seen = new Set<string>()

    for (const row of rows) {
        if (row.action && !seen.has(row.action)) {
            seen.add(row.action)
        }
    }

    return Array.from(seen)
}

// Ensure new history action types start enabled while preserving any existing checkbox choices.
function syncHistoryTypeSelection(selection: HistoryTypeSelection, types: string[]): HistoryTypeSelection {
    const nextSelection: HistoryTypeSelection = {}

    for (const type of types) {
        nextSelection[type] = selection[type] ?? true
    }

    return nextSelection
}

// Map a signed cash string to the shared gain/loss tone class.
function cashTone(cash: string): string {
    if (cash.startsWith('+')) {
        return 'pos'
    }

    if (cash.startsWith('-')) {
        return 'neg'
    }

    return ''
}

// Render the Histories tab: a reverse-chronological table of recorded account activity keyed on the
// simulated date. The log is reloaded from the API each time the tab mounts so it stays current.
export function Histories() {
    const dispatch = useAppDispatch()
    const entries = useAppSelector((state) => state.account.historyEntries)
    const [selectedTypes, setSelectedTypes] = useState<HistoryTypeSelection>({})
    const rows = entries.map(parseHistoryLine).reverse()
    const availableTypes = listHistoryTypes(rows)
    const availableTypesKey = availableTypes.join('|')
    const effectiveSelectedTypes = syncHistoryTypeSelection(selectedTypes, availableTypes)
    const visibleRows = rows.filter((row) => effectiveSelectedTypes[row.action] ?? true)

    useEffect(() => {
        void dispatch(loadHistory())
    }, [dispatch])

    useEffect(() => {
        setSelectedTypes((current) => syncHistoryTypeSelection(current, availableTypes))
    }, [availableTypesKey])

    // Flip a single action-type checkbox without disturbing the others.
    function toggleType(type: string) {
        setSelectedTypes((current) => ({
            ...current,
            [type]: !(current[type] ?? true),
        }))
    }

    if (entries.length === 0) {
        return <div className="historiesEmpty">No activity recorded yet. Buys, sells, dividends, deposits, and corporate actions will show up here.</div>
    }

    return (
        <section className="histories">
            <div className="historiesToolbar">
                <span className="historiesToolbarLabel">Show types</span>
                <div className="historiesFilters" role="group" aria-label="Filter history by event type">
                    {availableTypes.map((type) => (
                        <label key={type} className="historiesFilterOption">
                            <input
                                checked={effectiveSelectedTypes[type] ?? true}
                                className="historiesFilterCheckbox"
                                onChange={() => toggleType(type)}
                                type="checkbox"
                            />
                            <span>{type}</span>
                        </label>
                    ))}
                </div>
            </div>
            <div className="tableScroll">
                {visibleRows.length === 0 ? (
                    <div className="historiesFilteredEmpty">No history rows match the selected data types.</div>
                ) : (
                    <table className="historiesTable">
                        <thead>
                            <tr>
                                <th className="alignLeft" scope="col">Date</th>
                                <th className="alignLeft" scope="col">Action</th>
                                <th className="alignLeft" scope="col">Symbol</th>
                                <th scope="col">Qty</th>
                                <th scope="col">Price</th>
                                <th className="alignLeft" scope="col">Acquired</th>
                                <th className="alignLeft" scope="col">Term</th>
                                <th scope="col">Cash</th>
                                <th className="alignLeft" scope="col">Note</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRows.map((row, index) => (
                                <tr key={`${row.date}-${row.action}-${index}`}>
                                    <td className="alignLeft">{row.date}</td>
                                    <td className="alignLeft action">{row.action}</td>
                                    <td className="alignLeft symbol">{row.symbol || '—'}</td>
                                    <td>{row.quantity || '—'}</td>
                                    <td>{row.price || '—'}</td>
                                    <td className="alignLeft">{row.acquired || '—'}</td>
                                    <td className="alignLeft">{row.term ? <span className={`termBadge ${row.term.toLowerCase()}`}>{row.term}</span> : '—'}</td>
                                    <td className={cashTone(row.cash)}>{row.cash || '—'}</td>
                                    <td className="alignLeft note">{row.note || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </section>
    )
}
