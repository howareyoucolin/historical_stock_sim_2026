import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME, normalizeStockCode, validateStockCode } from './download-data'

export const EPS_FILE_NAME = 'eps.json'
export const DATA_FILE_NAME = 'data.json'

type NullableNumber = number | null

interface HistoryEntry {
    close: NullableNumber
    isPayoutDate: boolean
    dividendPerShare: number
}

interface HistoryFile {
    stockCode: string
    source: string
    range?: { start: string; end: string }
    historyByDate: Record<string, HistoryEntry>
}

interface EpsFile {
    stockCode: string
    metric?: string
    source?: string
    sourceUrl?: string
    epsByDate: Record<string, number>
}

export interface DataEntry extends HistoryEntry {
    ttmEps: NullableNumber
    peRatio: NullableNumber
}

export interface BuiltDataPayload {
    stockCode: string
    sources: {
        priceHistory: { source: string; file: string }
        eps: { source?: string; sourceUrl?: string; metric?: string; file: string }
    }
    range: { start: string; end: string }
    fields: Record<string, string>
    historyByDate: Record<string, DataEntry>
}

export interface BuildStockDataResult extends BuiltDataPayload {
    rowCount: number
    outputPath: string
}

interface BuildStockDataActionDependencies {
    cwd?: () => string
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
}

const FIELD_DESCRIPTIONS: Record<string, string> = {
    close: 'Daily closing price',
    isPayoutDate: 'Whether a dividend was paid on this date',
    dividendPerShare: 'Dividend per share paid on this date',
    ttmEps: 'Most recent reported trailing-twelve-month Net EPS as of this date (forward-filled from quarterly reports)',
    peRatio: 'Derived price-to-earnings ratio: close / ttmEps (null when either input is unavailable)',
}

// Round a derived ratio to two decimals so the output file stays readable.
function roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100
}

// Find the latest reported TTM EPS on or before the given day, forward-filling
// the quarterly figures across the daily price series; returns null for days
// that precede the first reported quarter.
export function findTrailingEps(epsByDate: Record<string, number>, day: string): NullableNumber {
    let latestDate: string | null = null

    for (const epsDate of Object.keys(epsByDate)) {
        if (epsDate <= day && (latestDate === null || epsDate > latestDate)) {
            latestDate = epsDate
        }
    }

    return latestDate === null ? null : epsByDate[latestDate]
}

// Derive a price-to-earnings ratio from a close price and trailing EPS; the
// ratio is undefined without a price or a non-zero EPS.
export function derivePeRatio(close: NullableNumber, ttmEps: NullableNumber): NullableNumber {
    if (close === null || ttmEps === null || ttmEps === 0) {
        return null
    }

    return roundToTwoDecimals(close / ttmEps)
}

// Merge the daily price history with the quarterly EPS series, enriching each
// day with its trailing EPS and derived PE ratio.
export function buildHistoryByDate(historyByDate: Record<string, HistoryEntry>, epsByDate: Record<string, number>): Record<string, DataEntry> {
    const merged: Record<string, DataEntry> = {}

    for (const day of Object.keys(historyByDate).sort()) {
        const entry = historyByDate[day]
        const ttmEps = findTrailingEps(epsByDate, day)

        merged[day] = {
            close: entry.close,
            isPayoutDate: entry.isPayoutDate,
            dividendPerShare: entry.dividendPerShare,
            ttmEps,
            peRatio: derivePeRatio(entry.close, ttmEps),
        }
    }

    return merged
}

// Build the persisted JSON payload for the combined per-stock data file.
export function buildDataPayload(stockCode: string, history: HistoryFile, eps: EpsFile): BuiltDataPayload {
    const historyByDate = buildHistoryByDate(history.historyByDate, eps.epsByDate)
    const days = Object.keys(historyByDate).sort()

    if (days.length === 0) {
        throw new Error('No price history was found to build from.')
    }

    return {
        stockCode,
        sources: {
            priceHistory: { source: history.source, file: HISTORY_FILE_NAME },
            eps: { source: eps.source, sourceUrl: eps.sourceUrl, metric: eps.metric, file: EPS_FILE_NAME },
        },
        range: { start: days[0], end: days[days.length - 1] },
        fields: FIELD_DESCRIPTIONS,
        historyByDate,
    }
}

// Read and parse a required source file, reporting a clear error when it is missing.
async function readSourceJson<T>(readFile: (path: string, encoding: BufferEncoding) => Promise<string>, filePath: string, label: string): Promise<T> {
    let raw: string

    try {
        raw = await readFile(filePath, 'utf8')
    } catch {
        throw new Error(`Missing ${label} file: ${filePath}. Run \`stock download <code>\` and add ${EPS_FILE_NAME} first.`)
    }

    try {
        return JSON.parse(raw) as T
    } catch (error) {
        throw new Error(`Failed to parse ${label} file ${filePath}: ${(error as Error).message}`)
    }
}

// Create the reusable build action so the CLI and UI can share the merge logic.
export function createBuildStockDataAction({
    cwd = process.cwd,
    readFile = fs.readFile,
    makeDirectory = fs.mkdir,
    writeFile = fs.writeFile,
}: BuildStockDataActionDependencies = {}) {
    // Combine a stock's downloaded price history and EPS series into a single data.json file.
    return async function buildStockDataAction(stockCode: string): Promise<BuildStockDataResult> {
        const normalizedStockCode = normalizeStockCode(stockCode)

        validateStockCode(normalizedStockCode)

        const repoRoot = cwd()
        const stockDirectory = path.join(repoRoot, DATA_DIRECTORY_NAME, normalizedStockCode)
        const historyPath = path.join(stockDirectory, HISTORY_FILE_NAME)
        const epsPath = path.join(stockDirectory, EPS_FILE_NAME)

        const history = await readSourceJson<HistoryFile>(readFile, historyPath, 'price history')
        const eps = await readSourceJson<EpsFile>(readFile, epsPath, 'EPS')

        const payload = buildDataPayload(normalizedStockCode, history, eps)
        const outputPath = path.join(stockDirectory, DATA_FILE_NAME)

        await makeDirectory(stockDirectory, { recursive: true })
        await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

        return {
            ...payload,
            rowCount: Object.keys(payload.historyByDate).length,
            outputPath: path.relative(repoRoot, outputPath),
        }
    }
}

export const buildStockDataAction = createBuildStockDataAction()
