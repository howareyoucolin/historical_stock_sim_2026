import { readDefaultUserAccountSession, type AccountSessionDependencies } from '../account/model'
import { normalizeStockCode, validateStockCode } from './download-data'
import { fetchStockData, type MarketDataEntry, type StockDataFetcher } from './market-data-client'

type NullableNumber = number | null

type DataFileEntry = MarketDataEntry

export interface StockHistoryRow {
    date: string
    close: NullableNumber
    ttmEps: NullableNumber
    peRatio: NullableNumber
    dividendPerShare: number
    isPayoutDate: boolean
    sharesOutstanding?: NullableNumber
    marketCap?: NullableNumber
}

export interface StockHistoryDependencies extends AccountSessionDependencies {
    // Fetches a stock's daily series from the market-data API; injectable for tests.
    getStockData?: StockDataFetcher
}

// Fetch a stock's combined daily series from the market-data API, surfacing clear guidance when the
// symbol is unknown.
async function readStockDataFile(
    stockCode: string,
    { getStockData = fetchStockData }: StockHistoryDependencies
): Promise<{ historyByDate?: Record<string, DataFileEntry> }> {
    const payload = await getStockData(stockCode)

    if (payload === null) {
        throw new Error(`No market data found for ${stockCode}. It may not be a tradable symbol.`)
    }

    return payload
}

// Collect every recorded day from the start of the data file up to and including the simulation
// date, ordered oldest first so the series reads like a chronological ledger.
export function selectHistoryRowsThroughDate(historyByDate: Record<string, DataFileEntry>, throughDate: string): StockHistoryRow[] {
    return Object.keys(historyByDate)
        .filter((day) => day <= throughDate)
        .sort()
        .map((day) => ({ date: day, ...historyByDate[day] }))
}

// Build the chronological price/earnings history for a stock from the first recorded day through
// the shared account's current simulation date.
export async function buildStockHistory(
    stockCode: string,
    dependencies: StockHistoryDependencies = {}
): Promise<{ stockCode: string; throughDate: string; rows: StockHistoryRow[] }> {
    const normalizedStockCode = normalizeStockCode(stockCode)

    validateStockCode(normalizedStockCode)

    const account = await readDefaultUserAccountSession(dependencies)
    const dataFile = await readStockDataFile(normalizedStockCode, dependencies)
    const rows = selectHistoryRowsThroughDate(dataFile.historyByDate ?? {}, account.date)

    return { stockCode: normalizedStockCode, throughDate: account.date, rows }
}

// Render a numeric price/ratio cell, falling back to a dash when the value is unavailable.
function formatNumber(value: NullableNumber): string {
    return value === null || value === undefined ? '-' : value.toFixed(2)
}

// Show the per-share dividend only on payout days so the column stays readable across long spans.
function formatDividend(row: StockHistoryRow): string {
    return row.isPayoutDate ? row.dividendPerShare.toFixed(2) : '-'
}

// Render a padded table row so columns stay aligned in plain-text terminals.
function formatTableRow(cells: string[], widths: number[]): string {
    return cells
        .map((cell, index) => (index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index])))
        .join(' | ')
}

// Render the ASCII separator that sits between the table header and the data rows.
function formatTableSeparator(widths: number[]): string {
    return widths.map((width) => '-'.repeat(width)).join('-+-')
}

// Build the plain-text history table shown by the `stock history <code>` command.
function formatStockHistoryTable(rows: StockHistoryRow[]): string {
    const header = ['date', 'close', 'ttm_eps', 'pe_ratio', 'dividend']
    const dataRows = rows.map((row) => [row.date, formatNumber(row.close), formatNumber(row.ttmEps), formatNumber(row.peRatio), formatDividend(row)])
    const widths = header.map((heading, index) => Math.max(heading.length, ...dataRows.map((row) => row[index].length)))

    return [formatTableRow(header, widths), formatTableSeparator(widths), ...dataRows.map((row) => formatTableRow(row, widths))].join('\n')
}

// The resolved stock history: the chronological rows plus the code and cutoff date they cover.
export interface StockHistory {
    stockCode: string
    throughDate: string
    rows: StockHistoryRow[]
}

// Format a resolved stock history into the CLI table, so callers holding the rows (e.g. to also
// emit them as JSON) can render the human output without rebuilding it.
export function formatStockHistory({ stockCode, throughDate, rows }: StockHistory): string {
    if (rows.length === 0) {
        return `No history for ${stockCode} on or before ${throughDate}.`
    }

    const heading = `History for ${stockCode} from ${rows[0].date} to ${throughDate} (${rows.length} trading days):`

    return [heading, '', formatStockHistoryTable(rows)].join('\n')
}

// Build the CLI-friendly stock history view from the first recorded day through the account's date.
export async function showStockHistory(stockCode: string, dependencies: StockHistoryDependencies = {}): Promise<string> {
    return formatStockHistory(await buildStockHistory(stockCode, dependencies))
}
