import fs from 'node:fs/promises'
import path from 'node:path'

import { USER_SESSIONS_DIRECTORY_NAME } from './model'
import { DEFAULT_SESSION_NAME, valuesLogFileName } from '../session'
import type { DefaultUserAccountSessionView } from './view-model'

export const VALUES_LOG_FILE_NAME = 'values.log'
// Default session's values log path (each session keeps its own log inside its folder).
export const VALUES_LOG_RELATIVE_PATH = `${USER_SESSIONS_DIRECTORY_NAME}/${DEFAULT_SESSION_NAME}/${VALUES_LOG_FILE_NAME}`

// Repo-relative path of the values log for the currently active session (session-aware).
function sessionValuesLogRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${valuesLogFileName()}`
}

// A single recorded portfolio total value (cash + market value of all holdings) on a simulation day.
export interface DailyValueSnapshot {
    date: string
    value: number
}

export interface ValuesLogDependencies {
    cwd?: () => string
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    appendFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
    removeFile?: (path: string) => Promise<unknown>
}

// Format one append-only line as "<simDate> <value>" so the log stays grep-friendly and easy to parse.
function formatValueLogLine(snapshot: DailyValueSnapshot): string {
    return `${snapshot.date} ${snapshot.value.toFixed(2)}`
}

// Append one daily total-value snapshot to the gitignored values log, creating the file on first use.
export async function recordDailyValue(
    snapshot: DailyValueSnapshot,
    {
        cwd = process.cwd,
        makeDirectory = fs.mkdir,
        appendFile = fs.appendFile,
    }: ValuesLogDependencies = {}
): Promise<void> {
    const logFilePath = path.join(cwd(), sessionValuesLogRelativePath())

    await makeDirectory(path.dirname(logFilePath), { recursive: true })
    await appendFile(logFilePath, `${formatValueLogLine(snapshot)}\n`, 'utf8')
}

// Record the current portfolio value carried by a built account view, used after non-advancing
// mutations (deposits, trades, reset) so the graph gains a point without advancing the date.
export async function recordViewValueSnapshot(
    view: DefaultUserAccountSessionView,
    dependencies: ValuesLogDependencies = {}
): Promise<void> {
    await recordDailyValue({ date: view.account.date, value: view.account.cash + view.summary.totalCurrentValue }, dependencies)
}

// Parse one stored line back into a snapshot, tolerating blank or malformed lines by returning null.
function parseValueLogLine(line: string): DailyValueSnapshot | null {
    const [date, rawValue] = line.trim().split(/\s+/)
    const value = Number(rawValue)

    if (!date || !Number.isFinite(value)) {
        return null
    }

    return { date, value }
}

// Read the recorded daily values as an ordered series for the summary graph. Multiple snapshots for
// the same day collapse to the last one written (the most recent value for that date), sorted by date.
export async function readDailyValues({
    cwd = process.cwd,
    readFile = fs.readFile,
}: ValuesLogDependencies = {}): Promise<DailyValueSnapshot[]> {
    const logFilePath = path.join(cwd(), sessionValuesLogRelativePath())

    let contents: string
    try {
        contents = (await readFile(logFilePath, 'utf8')).trim()
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return []
        }

        throw error
    }

    if (contents.length === 0) {
        return []
    }

    const latestByDate = new Map<string, number>()
    for (const line of contents.split('\n')) {
        const snapshot = parseValueLogLine(line)

        if (snapshot) {
            latestByDate.set(snapshot.date, snapshot.value)
        }
    }

    return Array.from(latestByDate, ([date, value]) => ({ date, value })).sort((left, right) =>
        left.date.localeCompare(right.date)
    )
}

// Drop the leading unfunded period (total value 0 before the first deposit) so the value series and
// graph begin when the portfolio first holds value. Setting a sim start date well after the account's
// default date walks the clock forward and records zero-value days; those leading zeros are noise.
// Interior zeros (e.g. a portfolio wiped out mid-run) are kept. An all-zero series collapses to empty.
export function trimLeadingZeroValues(snapshots: DailyValueSnapshot[]): DailyValueSnapshot[] {
    const firstFunded = snapshots.findIndex((snapshot) => snapshot.value !== 0)

    return firstFunded === -1 ? [] : snapshots.slice(firstFunded)
}

// Delete the values log so a fresh account starts with an empty value history; a missing file is fine.
export async function clearValueLog({
    cwd = process.cwd,
    removeFile = fs.rm,
}: ValuesLogDependencies = {}): Promise<void> {
    const logFilePath = path.join(cwd(), sessionValuesLogRelativePath())

    try {
        await removeFile(logFilePath)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return
        }

        throw error
    }
}
