'use client'

import { useEffect } from 'react'

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

    useEffect(() => {
        void dispatch(loadHistory())
    }, [dispatch])

    if (entries.length === 0) {
        return <div className="historiesEmpty">No activity recorded yet. Buys, sells, dividends, and deposits will show up here.</div>
    }

    const rows = entries.map(parseHistoryLine).reverse()

    return (
        <section className="histories">
            <div className="tableScroll">
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
                        {rows.map((row, index) => (
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
            </div>
        </section>
    )
}
