import { addDaysToSimulationDate } from '../date/utils'
import { buildStockHistory, type StockHistoryDependencies } from './history'

// A single plotted day on the price line.
export interface StockPricePoint {
    date: string
    close: number
}

// The full analysis snapshot for one stock as of the account's simulation date: the closing-price
// series up to that date plus the figures shown beside the chart.
export interface StockAnalysis {
    stockCode: string
    simDate: string
    asOfDate: string
    close: number
    previousClose: number | null
    change: number | null
    changePercent: number | null
    peRatio: number | null
    ttmEps: number | null
    lastDividendPerShare: number | null
    lastDividendDate: string | null
    high52: number
    low52: number
    points: StockPricePoint[]
}

// Number of calendar days in the trailing window used for the 52-week high and low.
const FIFTY_TWO_WEEK_DAYS = 365

// Build a stock's analysis snapshot from the first recorded day through the account's simulation
// date. Returns null when no priced trading day exists on or before that date. The closing-price
// series, day change, trailing 52-week range, and latest dividend are all measured as of that date.
export async function buildStockAnalysis(stockCode: string, dependencies: StockHistoryDependencies = {}): Promise<StockAnalysis | null> {
    const { stockCode: normalizedStockCode, throughDate, rows } = await buildStockHistory(stockCode, dependencies)

    // Only days with a real close can be plotted or measured against.
    const pricedRows = rows.filter((row): row is typeof row & { close: number } => row.close !== null)

    if (pricedRows.length === 0) {
        return null
    }

    const asOf = pricedRows[pricedRows.length - 1]
    const previousClose = pricedRows.length > 1 ? pricedRows[pricedRows.length - 2].close : null
    const change = previousClose === null ? null : asOf.close - previousClose
    const changePercent = previousClose === null || previousClose === 0 ? null : (change! / previousClose) * 100

    // Trailing 52-week window measured in calendar days back from the as-of date.
    const windowStart = addDaysToSimulationDate(asOf.date, -FIFTY_TWO_WEEK_DAYS)
    const windowCloses = pricedRows.filter((row) => row.date >= windowStart).map((row) => row.close)

    // The most recent dividend payout on or before the as-of date, if the stock has ever paid one.
    const lastDividend = [...pricedRows].reverse().find((row) => row.isPayoutDate && row.dividendPerShare > 0)

    return {
        stockCode: normalizedStockCode,
        simDate: throughDate,
        asOfDate: asOf.date,
        close: asOf.close,
        previousClose,
        change,
        changePercent,
        peRatio: asOf.peRatio,
        ttmEps: asOf.ttmEps,
        lastDividendPerShare: lastDividend ? lastDividend.dividendPerShare : null,
        lastDividendDate: lastDividend ? lastDividend.date : null,
        high52: Math.max(...windowCloses),
        low52: Math.min(...windowCloses),
        points: pricedRows.map((row) => ({ date: row.date, close: row.close })),
    }
}
