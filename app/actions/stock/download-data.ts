import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'

export const DATA_DIRECTORY_NAME = 'market-data'
export const HISTORY_FILE_NAME = 'history.json'

// The download window is configurable so it can be refreshed over time (e.g. bump the end date to
// today) without code changes. It lives in config/download-date-range.json; these are the fallbacks.
export const DATA_RANGE_CONFIG_RELATIVE_PATH = 'config/download-date-range.json'
const DEFAULT_START_DATE = '2010-01-01'
const DEFAULT_END_DATE = '2026-01-01'

interface DataRange {
    start: string
    end: string
}

// Resolve the effective download window from parsed config, filling either side from defaults so a
// partial or missing config never breaks downloads.
export function resolveDataRange(parsed: { start?: string; end?: string } | null): DataRange {
    return {
        start: parsed?.start ?? DEFAULT_START_DATE,
        end: parsed?.end ?? DEFAULT_END_DATE,
    }
}

// Load the download window from config/download-date-range.json once at startup, falling back to
// defaults if the file is missing or unreadable.
function loadDataRange(): DataRange {
    try {
        const raw = readFileSync(path.join(process.cwd(), DATA_RANGE_CONFIG_RELATIVE_PATH), 'utf8')

        return resolveDataRange(JSON.parse(raw) as { start?: string; end?: string })
    } catch {
        return resolveDataRange(null)
    }
}

const { start: START_DATE, end: END_DATE } = loadDataRange()

export { START_DATE, END_DATE }

type NullableNumber = number | null

export interface HistoryEntry {
    close: NullableNumber
    isPayoutDate: boolean
    dividendPerShare: number
}

export type HistoryByDate = Record<string, HistoryEntry>

export interface DownloadedHistoryPayload {
    stockCode: string
    source: 'Yahoo Finance'
    range: {
        start: string
        end: string
    }
    historyByDate: HistoryByDate
}

export interface DownloadStockDataResult extends DownloadedHistoryPayload {
    rowCount: number
    outputPath: string
    skipped: false
}

// Result returned when a stock action is skipped because its output file already exists.
export interface SkippedStockActionResult {
    skipped: true
    stockCode: string
    outputPath: string
}

interface YahooDividendEvent {
    amount?: number
    date: number
}

interface YahooQuoteSeries {
    close?: Array<number | null>
}

interface YahooChartResult {
    timestamp?: number[]
    indicators?: {
        quote?: YahooQuoteSeries[]
    }
    events?: {
        dividends?: Record<string, YahooDividendEvent>
    }
}

interface YahooChartPayload {
    chart?: {
        result?: YahooChartResult[]
        error?: {
            description?: string
        } | null
    }
}

interface DownloadStockDataActionDependencies {
    cwd?: () => string
    fetchRemoteJson?: (url: string) => Promise<YahooChartPayload>
    fileExists?: (path: string) => Promise<boolean>
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
}

// Normalize a stock symbol before it is sent to Yahoo Finance.
export function normalizeStockCode(stockCode: string): string {
    return stockCode.trim().toUpperCase()
}

// Validate that a stock symbol is safe for use in requests and file paths.
export function validateStockCode(stockCode: string): void {
    if (!/^[A-Z0-9.-]+$/.test(stockCode)) {
        throw new Error('Stock code may only contain letters, numbers, dots, and dashes.')
    }
}

// Convert a date string into a Unix timestamp in seconds.
export function toUnixSeconds(dateString: string): number {
    return Math.floor(new Date(`${dateString}T00:00:00Z`).getTime() / 1000)
}

// Build the Yahoo Finance chart endpoint for the requested stock code.
export function getHistoryUrl(stockCode: string): string {
    const period1 = toUnixSeconds(START_DATE)
    const period2 = toUnixSeconds(END_DATE)

    return [
        'https://query1.finance.yahoo.com/v8/finance/chart/',
        encodeURIComponent(stockCode),
        `?period1=${period1}`,
        `&period2=${period2}`,
        '&interval=1d',
        '&includePrePost=false',
        '&events=div,splits',
    ].join('')
}

// Fetch and parse JSON from an HTTPS endpoint.
async function fetchJson(url: string): Promise<YahooChartPayload> {
    return new Promise((resolve, reject) => {
        https
            .get(
                url,
                {
                    headers: {
                        'User-Agent': 'StockSimulate2026 CLI',
                    },
                },
                (response) => {
                    const { statusCode = 0, headers } = response

                    if (statusCode >= 300 && statusCode < 400 && headers.location) {
                        response.resume()
                        void fetchJson(headers.location).then(resolve).catch(reject)
                        return
                    }

                    if (statusCode !== 200) {
                        response.resume()
                        reject(new Error(`Yahoo Finance request failed with status ${statusCode}.`))
                        return
                    }

                    let rawData = ''

                    response.setEncoding('utf8')
                    response.on('data', (chunk) => {
                        rawData += chunk
                    })
                    response.on('end', () => {
                        try {
                            resolve(JSON.parse(rawData) as YahooChartPayload)
                        } catch (error) {
                            reject(new Error(`Failed to parse Yahoo Finance response: ${(error as Error).message}`))
                        }
                    })
                }
            )
            .on('error', (error) => {
                reject(new Error(`Yahoo Finance request failed: ${error.message}`))
            })
    })
}

// Report whether a path already exists on disk.
export async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath)
        return true
    } catch {
        return false
    }
}

// Convert undefined quote values into explicit JSON nulls.
function toNullableValue(value: number | null | undefined): NullableNumber {
    if (value === null || value === undefined) {
        return null
    }

    return value
}

// Build a date-keyed dividend lookup from Yahoo Finance event data.
export function buildDividendMap(chartResult: YahooChartResult): Map<string, number> {
    const dividendEvents = chartResult.events?.dividends || {}
    const dividendMap = new Map<string, number>()

    for (const dividendEvent of Object.values(dividendEvents)) {
        const isoDate = new Date(dividendEvent.date * 1000).toISOString().slice(0, 10)
        const existingAmount = dividendMap.get(isoDate) || 0

        dividendMap.set(isoDate, existingAmount + (dividendEvent.amount || 0))
    }

    return dividendMap
}

// Build a date-keyed history lookup that is easy for the UI to query directly.
export function buildHistoryByDate(chartResult: YahooChartResult): HistoryByDate {
    const timestamps = chartResult.timestamp || []
    const quote = chartResult.indicators?.quote?.[0]
    const dividendMap = buildDividendMap(chartResult)

    if (!quote || timestamps.length === 0) {
        throw new Error('No historical price data was returned for that stock code.')
    }

    const historyByDate: HistoryByDate = {}

    for (let index = 0; index < timestamps.length; index += 1) {
        const isoDate = new Date(timestamps[index] * 1000).toISOString().slice(0, 10)
        const dividendPerShare = dividendMap.get(isoDate) || 0

        historyByDate[isoDate] = {
            close: toNullableValue(quote.close?.[index]),
            isPayoutDate: dividendMap.has(isoDate),
            dividendPerShare,
        }
    }

    return historyByDate
}

// Build the persisted JSON payload for a downloaded stock history file.
export function buildHistoryPayload(stockCode: string, chartResult: YahooChartResult): DownloadedHistoryPayload {
    return {
        stockCode,
        source: 'Yahoo Finance',
        range: {
            start: START_DATE,
            end: END_DATE,
        },
        historyByDate: buildHistoryByDate(chartResult),
    }
}

// Create the reusable stock download action so CLI and UI can share it later.
export function createDownloadStockDataAction({
    cwd = process.cwd,
    fetchRemoteJson = fetchJson,
    fileExists = pathExists,
    makeDirectory = fs.mkdir,
    writeFile = fs.writeFile,
}: DownloadStockDataActionDependencies = {}) {
    // Download a stock history from Yahoo Finance and save it to the repo, skipping
    // the download when the history file already exists.
    return async function downloadStockDataAction(stockCode: string): Promise<DownloadStockDataResult | SkippedStockActionResult> {
        const normalizedStockCode = normalizeStockCode(stockCode)

        validateStockCode(normalizedStockCode)

        const repoRoot = cwd()
        const outputDirectory = path.join(repoRoot, DATA_DIRECTORY_NAME, normalizedStockCode)
        const outputPath = path.join(outputDirectory, HISTORY_FILE_NAME)

        if (await fileExists(outputPath)) {
            return { skipped: true, stockCode: normalizedStockCode, outputPath: path.relative(repoRoot, outputPath) }
        }

        const url = getHistoryUrl(normalizedStockCode)
        const payload = await fetchRemoteJson(url)
        const chart = payload.chart
        const result = chart?.result?.[0]
        const error = chart?.error

        if (error) {
            throw new Error(error.description || 'Yahoo Finance returned an unknown error.')
        }

        if (!result) {
            throw new Error('No stock history was returned by Yahoo Finance.')
        }

        const payloadToWrite = buildHistoryPayload(normalizedStockCode, result)

        await makeDirectory(outputDirectory, { recursive: true })
        await writeFile(outputPath, `${JSON.stringify(payloadToWrite, null, 2)}\n`, 'utf8')

        return {
            ...payloadToWrite,
            rowCount: Object.keys(payloadToWrite.historyByDate).length,
            outputPath: path.relative(repoRoot, outputPath),
            skipped: false,
        }
    }
}

export const downloadStockDataAction = createDownloadStockDataAction()
