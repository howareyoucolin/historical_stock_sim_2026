import { buildStockHistory, formatStockHistory } from '../../app/actions/stock/history'
import { buildStockInfo, formatStockInfo } from '../../app/actions/stock/info'
import { buildStockList, formatStockList } from '../../app/actions/stock/list'
import { buildStockStatus, formatStockStatus, formatMarketCap, type StockStatus } from '../../app/actions/stock/status'
import type { CommandResult } from '../command-types'

export interface StockCommandDependencies {
    fetchStockHistory?: typeof buildStockHistory
    fetchStockInfo?: typeof buildStockInfo
    fetchStockStatus?: typeof buildStockStatus
    fetchStockList?: typeof buildStockList
}

export const STOCK_HELP_LINES = [
    '  stock history <code>     Daily series through the account date (also: --last=<n>, --since=<date>)',
    '  stock info <code>        Show the stock profile (company, segment, industry)',
    '  stock status <code>      Show the stock data for the account simulation date (incl. 52w high/low)',
    '  stock price <code>       Show just the close and day change for the account date',
    '  stock list               List every available stock code',
    '  stock compare <codes...> Compare several stocks side by side on the account date',
    '  stock screen [filters]   Screen all stocks (--max-pe, --min-pe, --max-price, --min-price, --min-cap, --max-cap (billions), --min-drawdown, --max-drawdown (% below 52w high), --dividends, --limit)',
]

// Format a number that may be unavailable, falling back to a dash.
function formatNumber(value: number | null): string {
    return value === null || value === undefined ? '-' : value.toFixed(2)
}

// A flattened, comparable row built from a stock's sim-date status snapshot.
interface ComparisonRow {
    stockCode: string
    asOfDate: string | null
    close: number | null
    changePercent: number | null
    marketCap: number | null
    peRatio: number | null
    ttmEps: number | null
    isPayoutDate: boolean
    pctFrom52wHigh: number | null
}

// Flatten a status snapshot into a comparison row, computing the day change percent.
function toComparisonRow(status: StockStatus): ComparisonRow {
    const close = status.row?.close ?? null
    const changePercent = status.previousClose === null || status.previousClose === 0 || close === null ? null : ((close - status.previousClose) / status.previousClose) * 100

    return {
        stockCode: status.stockCode,
        asOfDate: status.asOfDate,
        close,
        changePercent,
        marketCap: status.row?.marketCap ?? null,
        peRatio: status.row?.peRatio ?? null,
        ttmEps: status.row?.ttmEps ?? null,
        isPayoutDate: status.row?.isPayoutDate ?? false,
        pctFrom52wHigh: status.pctFrom52wHigh,
    }
}

// Render comparison rows as an aligned plain-text table.
function formatComparisonTable(rows: ComparisonRow[]): string {
    const header = ['stock', 'close', 'change%', 'from_high%', 'market_cap', 'pe_ratio', 'ttm_eps', 'dividend']
    const dataRows = rows.map((row) => [
        row.stockCode,
        formatNumber(row.close),
        row.changePercent === null ? '-' : `${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(2)}%`,
        row.pctFrom52wHigh === null ? '-' : `${row.pctFrom52wHigh >= 0 ? '+' : ''}${row.pctFrom52wHigh.toFixed(1)}%`,
        formatMarketCap(row.marketCap),
        formatNumber(row.peRatio),
        formatNumber(row.ttmEps),
        row.isPayoutDate ? 'payout' : '-',
    ])
    const widths = header.map((heading, index) => Math.max(heading.length, ...dataRows.map((cells) => cells[index].length)))
    const renderRow = (cells: string[]) => cells.map((cell, index) => (index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index]))).join(' | ')

    return [renderRow(header), widths.map((width) => '-'.repeat(width)).join('-+-'), ...dataRows.map(renderRow)].join('\n')
}

// Build the stock command handler so stock-specific workflows live in their own module.
export function createStockCommandHandler({
    fetchStockHistory = buildStockHistory,
    fetchStockInfo = buildStockInfo,
    fetchStockStatus = buildStockStatus,
    fetchStockList = buildStockList,
}: StockCommandDependencies = {}) {
    // Run `stock history <code> [--last=N] [--since=YYYY-MM-DD]` and print the saved data series
    // through the account's date. The optional window trims the (always sim-date-bounded) series to
    // its trailing N rows and/or rows on-or-after a date, so rolling calcs avoid the full payload.
    async function runHistory(args: string[]): Promise<CommandResult> {
        let code: string | undefined
        let last: number | undefined
        let since: string | undefined

        for (const arg of args) {
            if (arg.startsWith('--last=')) {
                last = Number(arg.slice('--last='.length))
                if (!Number.isInteger(last) || last <= 0) {
                    return { output: '--last must be a positive integer.', shouldExit: false, exitCode: 1 }
                }
            } else if (arg.startsWith('--since=')) {
                since = arg.slice('--since='.length)
            } else if (arg.startsWith('--')) {
                return { output: `Unknown flag: ${arg}`, shouldExit: false, exitCode: 1 }
            } else if (code === undefined) {
                code = arg
            } else {
                return { output: 'Usage: stock history <code> [--last=<n>] [--since=<YYYY-MM-DD>]', shouldExit: false, exitCode: 1 }
            }
        }

        if (code === undefined) {
            return { output: 'Usage: stock history <code> [--last=<n>] [--since=<YYYY-MM-DD>]', shouldExit: false, exitCode: 1 }
        }

        try {
            const result = await fetchStockHistory(code)
            // Apply the window (since first, then trailing N) without touching the sim-date bound above.
            let rows = result.rows
            if (since !== undefined) {
                rows = rows.filter((row) => row.date >= (since as string))
            }
            if (last !== undefined && rows.length > last) {
                rows = rows.slice(rows.length - last)
            }
            const windowed = { ...result, rows }

            return { output: formatStockHistory(windowed), data: windowed, shouldExit: false, exitCode: 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `History failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `stock info <code>` and print the stock's profile (company, segment, industry).
    async function runInfo(args: string[]): Promise<CommandResult> {
        if (args.length !== 1) {
            return { output: 'Usage: stock info <code>', shouldExit: false, exitCode: 1 }
        }

        try {
            const stockInfo = await fetchStockInfo(args[0])

            return { output: formatStockInfo(stockInfo), data: stockInfo, shouldExit: false, exitCode: 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Info failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `stock status <code>` and print the stock's data for the account's simulation date.
    async function runStatus(args: string[]): Promise<CommandResult> {
        if (args.length !== 1) {
            return { output: 'Usage: stock status <code>', shouldExit: false, exitCode: 1 }
        }

        try {
            const status = await fetchStockStatus(args[0])

            return { output: formatStockStatus(status), data: status, shouldExit: false, exitCode: 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Status failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `stock price <code>` and print just the close and day change for the account's date.
    async function runPrice(args: string[]): Promise<CommandResult> {
        if (args.length !== 1) {
            return { output: 'Usage: stock price <code>', shouldExit: false, exitCode: 1 }
        }

        try {
            const status = await fetchStockStatus(args[0])

            if (status.row === null || status.row.close === null) {
                return { output: `No price for ${status.stockCode} on or before ${status.simDate}.`, shouldExit: false, exitCode: 1 }
            }

            const close = status.row.close
            const change = status.previousClose === null ? null : close - status.previousClose
            const changePercent = status.previousClose === null || status.previousClose === 0 ? null : ((change as number) / status.previousClose) * 100
            const asOfNote = status.asOfDate === status.simDate ? '' : ` (as of ${status.asOfDate})`
            const changeText = change === null ? '' : ` ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent === null ? '-' : `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`})`

            return {
                output: `${status.stockCode} ${formatNumber(close)} USD on ${status.simDate}${asOfNote}${changeText}`,
                data: { stockCode: status.stockCode, simDate: status.simDate, asOfDate: status.asOfDate, close, previousClose: status.previousClose, change, changePercent },
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Price failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `stock list` and print every available stock code.
    async function runList(args: string[]): Promise<CommandResult> {
        if (args.length !== 0) {
            return { output: 'Usage: stock list', shouldExit: false, exitCode: 1 }
        }

        try {
            const stocks = await fetchStockList()

            return { output: formatStockList(stocks), data: { stocks, count: stocks.length }, shouldExit: false, exitCode: 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `List failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `stock compare <codes...>` and tabulate each stock's sim-date figures side by side.
    async function runCompare(args: string[]): Promise<CommandResult> {
        if (args.length === 0) {
            return { output: 'Usage: stock compare <code> [<code>...]', shouldExit: false, exitCode: 1 }
        }

        try {
            const rows: ComparisonRow[] = []
            for (const code of args) {
                rows.push(toComparisonRow(await fetchStockStatus(code)))
            }

            return { output: formatComparisonTable(rows), data: { rows }, shouldExit: false, exitCode: 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Compare failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `stock screen [filters]` over every available stock, keeping those that pass the filters.
    async function runScreen(args: string[]): Promise<CommandResult> {
        const filters: { maxPe?: number; minPe?: number; maxPrice?: number; minPrice?: number; minCap?: number; maxCap?: number; minDrawdown?: number; maxDrawdown?: number; dividends?: boolean; limit?: number } = {}

        for (const arg of args) {
            if (arg === '--dividends') {
                filters.dividends = true
            } else if (arg.startsWith('--max-pe=')) {
                filters.maxPe = Number(arg.slice('--max-pe='.length))
            } else if (arg.startsWith('--min-pe=')) {
                filters.minPe = Number(arg.slice('--min-pe='.length))
            } else if (arg.startsWith('--max-price=')) {
                filters.maxPrice = Number(arg.slice('--max-price='.length))
            } else if (arg.startsWith('--min-price=')) {
                filters.minPrice = Number(arg.slice('--min-price='.length))
            } else if (arg.startsWith('--min-cap=')) {
                // Cap filters are given in billions of dollars; data stores market cap in USD millions.
                filters.minCap = Number(arg.slice('--min-cap='.length)) * 1_000
            } else if (arg.startsWith('--max-cap=')) {
                filters.maxCap = Number(arg.slice('--max-cap='.length)) * 1_000
            } else if (arg.startsWith('--min-drawdown=')) {
                // Drawdown filters are a POSITIVE percent below the 52-week high (e.g. 30 = at least 30% off).
                filters.minDrawdown = Number(arg.slice('--min-drawdown='.length))
            } else if (arg.startsWith('--max-drawdown=')) {
                filters.maxDrawdown = Number(arg.slice('--max-drawdown='.length))
            } else if (arg.startsWith('--limit=')) {
                filters.limit = Number(arg.slice('--limit='.length))
            } else {
                return { output: `Unknown screen filter: ${arg}`, shouldExit: false, exitCode: 1 }
            }
        }

        try {
            const codes = await fetchStockList()
            let rows: ComparisonRow[] = []

            // Build each stock's snapshot in bounded-concurrency batches (each snapshot is its own
            // market-data fetch, so fetching serially over ~1000 codes is the screen's main cost).
            // Skip any stock with no priced sim-date data rather than failing the whole screen.
            const SCREEN_CONCURRENCY = 16
            for (let start = 0; start < codes.length; start += SCREEN_CONCURRENCY) {
                const batch = codes.slice(start, start + SCREEN_CONCURRENCY)
                const settled = await Promise.all(
                    batch.map(async (code) => {
                        try {
                            return toComparisonRow(await fetchStockStatus(code))
                        } catch {
                            return null
                        }
                    })
                )
                for (const row of settled) {
                    if (row !== null) {
                        rows.push(row)
                    }
                }
            }

            rows = rows.filter((row) => {
                if (row.close === null) {
                    return false
                }
                if (filters.maxPrice !== undefined && row.close > filters.maxPrice) {
                    return false
                }
                if (filters.minPrice !== undefined && row.close < filters.minPrice) {
                    return false
                }
                // Cap filters only keep stocks that actually have a market cap (excludes ETFs).
                if (filters.minCap !== undefined && (row.marketCap === null || row.marketCap < filters.minCap)) {
                    return false
                }
                if (filters.maxCap !== undefined && (row.marketCap === null || row.marketCap > filters.maxCap)) {
                    return false
                }
                if (filters.dividends && !row.isPayoutDate) {
                    return false
                }
                // Drawdown filters (percent below the 52-week high). Only keep names with a known
                // 52w high; `drop` is positive when below the high.
                if (filters.minDrawdown !== undefined || filters.maxDrawdown !== undefined) {
                    if (row.pctFrom52wHigh === null) {
                        return false
                    }
                    const drop = -row.pctFrom52wHigh
                    if (filters.minDrawdown !== undefined && drop < filters.minDrawdown) {
                        return false
                    }
                    if (filters.maxDrawdown !== undefined && drop > filters.maxDrawdown) {
                        return false
                    }
                }
                // PE filters only keep stocks that actually have a PE ratio.
                if (filters.maxPe !== undefined && (row.peRatio === null || row.peRatio > filters.maxPe)) {
                    return false
                }
                if (filters.minPe !== undefined && (row.peRatio === null || row.peRatio < filters.minPe)) {
                    return false
                }

                return true
            })

            if (filters.limit !== undefined && filters.limit > 0) {
                rows = rows.slice(0, filters.limit)
            }

            const output = rows.length === 0 ? 'No stocks match the screen.' : `${rows.length} matches:\n\n${formatComparisonTable(rows)}`

            return { output, data: { rows, count: rows.length }, shouldExit: false, exitCode: 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Screen failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Execute the `stock` command family and dispatch to its subcommands.
    return async function runStockCommand(args: string[]): Promise<CommandResult> {
        switch (args[0]) {
            case 'history':
                return runHistory(args.slice(1))
            case 'info':
                return runInfo(args.slice(1))
            case 'status':
                return runStatus(args.slice(1))
            case 'price':
                return runPrice(args.slice(1))
            case 'list':
                return runList(args.slice(1))
            case 'compare':
                return runCompare(args.slice(1))
            case 'screen':
                return runScreen(args.slice(1))
            default:
                return { output: 'Usage: stock <history <code>|info <code>|status <code>|price <code>|list|compare <codes...>|screen [filters]>', shouldExit: false, exitCode: 1 }
        }
    }
}
