import { readHistoryLogEntries } from '../../app/actions/history/log'
import type { CommandResult } from '../command-types'

export interface HistoryCommandDependencies {
    readHistoryEntries?: typeof readHistoryLogEntries
}

export const HISTORY_HELP_LINES = [
    '  history show           Show recorded activity (filters: --type, --stock, --since, --until, --limit)',
]

// A parsed history line. `note` is split off first because it is JSON-quoted and may contain spaces.
interface ParsedHistoryEntry {
    raw: string
    timestamp: string
    type: string
    stock?: string
    qty?: number
    price?: number
    acquired?: string
    term?: string
    cash?: string
    sim?: string
    note?: string
}

// Parse one append-only log line into structured fields. The trailing `note=<json>` is extracted
// before the remaining space-separated `key=value` tokens so a multi-word note never mis-splits.
function parseHistoryEntry(line: string): ParsedHistoryEntry {
    let head = line
    let note: string | undefined
    const noteMarker = ' note='

    const noteIndex = line.indexOf(noteMarker)
    if (noteIndex !== -1) {
        const rawNote = line.slice(noteIndex + noteMarker.length)
        try {
            note = JSON.parse(rawNote) as string
        } catch {
            note = rawNote
        }
        head = line.slice(0, noteIndex)
    }

    const [timestamp = '', type = '', ...rest] = head.split(' ')
    const fields: Record<string, string> = {}
    for (const token of rest) {
        const separatorIndex = token.indexOf('=')
        if (separatorIndex !== -1) {
            fields[token.slice(0, separatorIndex)] = token.slice(separatorIndex + 1)
        }
    }

    return {
        raw: line,
        timestamp,
        type,
        stock: fields.stock,
        qty: fields.qty !== undefined ? Number(fields.qty) : undefined,
        price: fields.price !== undefined ? Number(fields.price) : undefined,
        acquired: fields.acquired,
        term: fields.term,
        cash: fields.cash,
        sim: fields.sim,
        note,
    }
}

interface HistoryFilters {
    type?: string
    stock?: string
    since?: string
    until?: string
    limit?: number
    error?: string
}

// Parse the optional history filters out of args.
function parseHistoryFilters(args: string[]): HistoryFilters {
    const filters: HistoryFilters = {}

    for (const arg of args) {
        if (arg.startsWith('--type=')) {
            filters.type = arg.slice('--type='.length).toUpperCase()
        } else if (arg.startsWith('--stock=')) {
            filters.stock = arg.slice('--stock='.length).toUpperCase()
        } else if (arg.startsWith('--since=')) {
            filters.since = arg.slice('--since='.length)
        } else if (arg.startsWith('--until=')) {
            filters.until = arg.slice('--until='.length)
        } else if (arg.startsWith('--limit=')) {
            const value = Number(arg.slice('--limit='.length))
            if (!Number.isInteger(value) || value <= 0) {
                filters.error = 'Limit must be a positive integer.'
            } else {
                filters.limit = value
            }
        } else {
            filters.error = `Unknown history filter: ${arg}`
        }
    }

    return filters
}

// Keep entries matching every provided filter; date filters compare against the simulated date.
function applyHistoryFilters(entries: ParsedHistoryEntry[], filters: HistoryFilters): ParsedHistoryEntry[] {
    let matched = entries.filter((entry) => {
        if (filters.type && entry.type !== filters.type) {
            return false
        }
        if (filters.stock && entry.stock?.toUpperCase() !== filters.stock) {
            return false
        }
        if (filters.since && (entry.sim ?? '') < filters.since) {
            return false
        }
        if (filters.until && (entry.sim ?? '') > filters.until) {
            return false
        }

        return true
    })

    // `--limit` keeps the most recent N matches (entries are stored oldest-first).
    if (filters.limit !== undefined) {
        matched = matched.slice(-filters.limit)
    }

    return matched
}

// Build the history command handler so history-log behavior stays out of the main router.
export function createHistoryCommandHandler({ readHistoryEntries = readHistoryLogEntries }: HistoryCommandDependencies = {}) {
    // Execute the `history` command family against the shared history log file.
    return async function runHistoryCommand(args: string[]): Promise<CommandResult> {
        if (args[0] !== 'show') {
            return { output: 'Usage: history show [--type=<TYPE>] [--stock=<CODE>] [--since=<date>] [--until=<date>] [--limit=<n>]', shouldExit: false, exitCode: 1 }
        }

        const filters = parseHistoryFilters(args.slice(1))

        if (filters.error) {
            return { output: filters.error, shouldExit: false, exitCode: 1 }
        }

        try {
            const allEntries = (await readHistoryEntries()).map(parseHistoryEntry)
            const entries = applyHistoryFilters(allEntries, filters)
            const output = entries.length === 0 ? (allEntries.length === 0 ? 'No history events recorded yet.' : 'No matching history events.') : entries.map((entry) => entry.raw).join('\n')

            return { output, data: { entries, count: entries.length }, shouldExit: false, exitCode: 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `History show failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }
}
