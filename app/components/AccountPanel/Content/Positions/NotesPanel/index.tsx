'use client'

import './style.css'
import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../../../../../store/hooks'
import { loadHistory } from '../../Histories/actions'

// How long after a note is recorded it still counts as "new" and plays the entrance animation.
// Comfortably covers the refresh latency so a freshly written note animates when it first shows.
const NEW_NOTE_HIGHLIGHT_MS = 15000

// A single trade note pulled from a history line, with the context needed to label and order it.
interface NoteEntry {
    // The full raw log line, used as a stable React key so prepending a note inserts one new node.
    id: string
    // Wall-clock ISO timestamp the line was recorded, used to decide if the note is new enough to animate.
    timestamp: string
    date: string
    action: string
    symbol: string
    note: string
}

// Parse the note (and its label context) out of one raw history line, or return null when the line
// carries no note. The note is JSON-quoted and always the last token, so everything after `note=`
// is parsed as a unit to preserve spaces; the leading tokens before it yield the timestamp/date/symbol.
function parseNoteEntry(line: string): NoteEntry | null {
    const noteMarker = ' note='
    const markerIndex = line.indexOf(noteMarker)

    if (markerIndex === -1) {
        return null
    }

    const rawNote = line.slice(markerIndex + noteMarker.length)
    let note: string

    try {
        note = JSON.parse(rawNote)
    } catch {
        note = rawNote
    }

    const [timestamp = '', action = '', ...rest] = line.slice(0, markerIndex).split(' ')
    const fields: Record<string, string> = {}

    for (const token of rest) {
        const separatorIndex = token.indexOf('=')

        if (separatorIndex !== -1) {
            fields[token.slice(0, separatorIndex)] = token.slice(separatorIndex + 1)
        }
    }

    return { id: line, timestamp, date: fields.sim ?? '', action, symbol: fields.stock ?? '', note }
}

// Render the fixed-height notes rail beside the holdings table: a newest-first stack of trade notes.
// Each new note is pushed onto the top and shifts the older notes down, with overflow scrolling.
export function NotesPanel() {
    const dispatch = useAppDispatch()
    const entries = useAppSelector((state) => state.account.historyEntries)

    // History is loaded by the Histories tab on mount; load it here too so the rail is populated
    // even when the user lands directly on the Positions tab.
    useEffect(() => {
        void dispatch(loadHistory())
    }, [dispatch])

    // History is stored oldest-first; reverse so the most recent note sits at the top of the stack.
    const notes = entries
        .map(parseNoteEntry)
        .filter((entry): entry is NoteEntry => entry !== null)
        .reverse()

    // Mark notes recorded within the recency window as new so they play the entrance animation once.
    const now = Date.now()

    return (
        <aside className="notesPanel">
            <div className="notesHead">
                <h2>Notes</h2>
                <span className="noteCount">{notes.length}</span>
            </div>

            {notes.length === 0 ? (
                <div className="notesEmpty">No trade notes yet. Notes attached to buys and sells show up here.</div>
            ) : (
                <div className="notesFeed">
                    {notes.map((entry) => {
                        const isNew = now - Date.parse(entry.timestamp) < NEW_NOTE_HIGHLIGHT_MS

                        return (
                            <div className={`noteItem${isNew ? ' isNew' : ''}`} key={entry.id}>
                                <div className="noteMeta">
                                    <span className={`noteAction ${entry.action.toLowerCase()}`}>{entry.action}</span>
                                    {entry.symbol && <span className="noteSymbol">{entry.symbol}</span>}
                                    <span className="noteDate">{entry.date}</span>
                                </div>
                                <p className="noteText">{entry.note}</p>
                            </div>
                        )
                    })}
                </div>
            )}
        </aside>
    )
}
