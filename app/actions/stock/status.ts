import { buildStockHistory, type StockHistoryDependencies, type StockHistoryRow } from './history'

export interface StockStatus {
    stockCode: string
    simDate: string
    asOfDate: string | null
    row: StockHistoryRow | null
    previousClose: number | null
}

// Resolve a stock's market data as of the account's simulation date, falling back to the most
// recent trading day on or before it so non-trading sim dates (weekends, holidays) still report.
// `row` is null when the simulation date precedes every recorded day for the stock.
export async function buildStockStatus(stockCode: string, dependencies: StockHistoryDependencies = {}): Promise<StockStatus> {
    const { stockCode: normalizedStockCode, throughDate, rows } = await buildStockHistory(stockCode, dependencies)

    if (rows.length === 0) {
        return { stockCode: normalizedStockCode, simDate: throughDate, asOfDate: null, row: null, previousClose: null }
    }

    const row = rows[rows.length - 1]
    const previousClose = rows.length > 1 ? rows[rows.length - 2].close : null

    return { stockCode: normalizedStockCode, simDate: throughDate, asOfDate: row.date, row, previousClose }
}

// Render a numeric price/ratio value, falling back to a dash when it is unavailable.
function formatNumber(value: number | null): string {
    return value === null || value === undefined ? '-' : value.toFixed(2)
}

// Render a market cap (given in USD millions) with a magnitude suffix, e.g. 2311050 -> "2.31T".
export function formatMarketCap(millions: number | null | undefined): string {
    if (millions === null || millions === undefined) {
        return '-'
    }

    if (millions >= 1_000_000) {
        return `${(millions / 1_000_000).toFixed(2)}T`
    }

    if (millions >= 1_000) {
        return `${(millions / 1_000).toFixed(1)}B`
    }

    return `${millions.toFixed(0)}M`
}

// Describe the day's move against the prior trading close as an absolute and percent change.
function formatChange(close: number | null, previousClose: number | null): string {
    if (close === null || previousClose === null) {
        return '-'
    }

    const change = close - previousClose
    const percent = previousClose === 0 ? 0 : (change / previousClose) * 100
    const sign = change >= 0 ? '+' : '-'

    return `${sign}${Math.abs(change).toFixed(2)} (${sign}${Math.abs(percent).toFixed(2)}%)`
}

// Show the per-share dividend only on payout days so the line stays meaningful.
function formatDividend(row: StockHistoryRow): string {
    return row.isPayoutDate ? `${row.dividendPerShare.toFixed(2)} (payout)` : '- (no payout)'
}

// Format a resolved status snapshot into the CLI block, so callers holding the structured snapshot
// (e.g. to also emit it as JSON) can render the human output without rebuilding it.
export function formatStockStatus({ stockCode, simDate, asOfDate, row, previousClose }: StockStatus): string {
    if (row === null) {
        return `No data for ${stockCode} on or before ${simDate}.`
    }

    // Flag when the sim date is not itself a trading day so the figures are not mistaken for that exact date.
    const asOfNote = asOfDate === simDate ? '' : ` (as of ${asOfDate})`

    return [
        `${stockCode} status on ${simDate}${asOfNote}:`,
        `  close:    ${formatNumber(row.close)}`,
        `  change:   ${formatChange(row.close, previousClose)}`,
        `  market_cap: ${formatMarketCap(row.marketCap)}`,
        `  pe_ratio: ${formatNumber(row.peRatio)}`,
        `  ttm_eps:  ${formatNumber(row.ttmEps)}`,
        `  dividend: ${formatDividend(row)}`,
    ].join('\n')
}

// Build the CLI-friendly snapshot of a stock on the account's current simulation date.
export async function showStockStatus(stockCode: string, dependencies: StockHistoryDependencies = {}): Promise<string> {
    return formatStockStatus(await buildStockStatus(stockCode, dependencies))
}
