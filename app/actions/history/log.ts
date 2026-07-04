import fs from 'node:fs/promises'
import path from 'node:path'

import { USER_SESSIONS_DIRECTORY_NAME } from '../account/model'
import { DEFAULT_SESSION_NAME, historyLogFileName } from '../session'

// Repo-relative path of the history log for the currently active session (session-aware).
function sessionLogRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${historyLogFileName()}`
}

export const HISTORY_LOG_FILE_NAME = 'history.log'
// Default session's history log path (each session keeps its own log inside its folder).
export const HISTORY_LOG_RELATIVE_PATH = `${USER_SESSIONS_DIRECTORY_NAME}/${DEFAULT_SESSION_NAME}/${HISTORY_LOG_FILE_NAME}`

export type HistoryEventType = 'BUY' | 'SELL' | 'DIVIDEND' | 'DEPOSIT' | 'INTEREST' | 'CORPORATE_ACTION'

// Capital-gains holding classification applied to sold lots: held more than one year is long-term.
export type HoldingTerm = 'SHORT' | 'LONG'

// A single recorded account activity. `quantity` and `pricePerShare` are optional so cash-only
// events (deposits) can omit them; for dividends they carry the share count and per-share payout.
// `acquiredDate` and `term` are set on sell rows so each sold purchase batch is recorded on its
// own line with its holding term. `note` is an optional free-text annotation passed on buy/sell from
// the CLI so an automation agent can record why a trade was made.
export interface HistoryEvent {
    type: HistoryEventType
    simDate: string
    cashDelta: number
    stockCode?: string
    quantity?: number
    pricePerShare?: number
    acquiredDate?: string
    term?: HoldingTerm
    note?: string
}

export interface HistoryLogDependencies {
    cwd?: () => string
    now?: () => Date
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    appendFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
    removeFile?: (path: string) => Promise<unknown>
}

const EMPTY_HISTORY_MESSAGE = 'No history events recorded yet.'

// Render a cash impact with an explicit sign so a glance at the log shows money in vs. out.
function formatSignedCurrency(value: number): string {
    return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`
}

// Build a single append-only log line as space-separated tokens, emitting only the fields that
// apply to the event so the format stays grep-friendly without empty placeholder columns.
function formatHistoryLogLine(event: HistoryEvent, timestamp: Date): string {
    const tokens = [timestamp.toISOString(), event.type]

    if (event.stockCode) {
        tokens.push(`stock=${event.stockCode}`)
    }

    if (event.quantity !== undefined) {
        tokens.push(`qty=${event.quantity}`)
    }

    if (event.pricePerShare !== undefined) {
        tokens.push(`price=${event.pricePerShare.toFixed(2)}`)
    }

    if (event.acquiredDate) {
        tokens.push(`acquired=${event.acquiredDate}`)
    }

    if (event.term) {
        tokens.push(`term=${event.term}`)
    }

    tokens.push(`cash=${formatSignedCurrency(event.cashDelta)}`, `sim=${event.simDate}`)

    // The note is kept last and JSON-quoted so multi-word text stays on one line and round-trips
    // cleanly, without disturbing the space-separated tokens that precede it.
    if (event.note) {
        tokens.push(`note=${JSON.stringify(event.note)}`)
    }

    return tokens.join(' ')
}

// Append a recorded activity to the gitignored history log, creating the file on first use.
export async function appendHistoryEvent(
    event: HistoryEvent,
    {
        cwd = process.cwd,
        now = () => new Date(),
        makeDirectory = fs.mkdir,
        appendFile = fs.appendFile,
    }: HistoryLogDependencies = {}
): Promise<void> {
    const logFilePath = path.join(cwd(), sessionLogRelativePath())

    await makeDirectory(path.dirname(logFilePath), { recursive: true })
    await appendFile(logFilePath, `${formatHistoryLogLine(event, now())}\n`, 'utf8')
}

// Delete the history log so a fresh account starts with an empty audit trail; a missing file is fine.
export async function clearHistoryLog({
    cwd = process.cwd,
    removeFile = fs.rm,
}: HistoryLogDependencies = {}): Promise<void> {
    const logFilePath = path.join(cwd(), sessionLogRelativePath())

    try {
        await removeFile(logFilePath)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return
        }

        throw error
    }
}

// Read the history log as an ordered list of raw entry lines for programmatic consumers such as
// the browser history tab; returns an empty array when nothing has been recorded yet.
export async function readHistoryLogEntries({
    cwd = process.cwd,
    readFile = fs.readFile,
}: HistoryLogDependencies = {}): Promise<string[]> {
    const logFilePath = path.join(cwd(), sessionLogRelativePath())

    try {
        const contents = (await readFile(logFilePath, 'utf8')).trim()

        return contents.length === 0 ? [] : contents.split('\n')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return []
        }

        throw error
    }
}

// Read the history log for display, returning a friendly placeholder when nothing is recorded yet.
export async function showHistoryLog({
    cwd = process.cwd,
    readFile = fs.readFile,
}: HistoryLogDependencies = {}): Promise<string> {
    const logFilePath = path.join(cwd(), sessionLogRelativePath())

    try {
        const contents = (await readFile(logFilePath, 'utf8')).trim()

        return contents.length === 0 ? EMPTY_HISTORY_MESSAGE : contents
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return EMPTY_HISTORY_MESSAGE
        }

        throw error
    }
}
