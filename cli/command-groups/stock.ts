import { buildStockDataAction } from '../../app/actions/stock/build-data'
import { downloadStockDataAction } from '../../app/actions/stock/download-data'
import { buildStockHistory, formatStockHistory } from '../../app/actions/stock/history'
import { buildStockList, formatStockList } from '../../app/actions/stock/list'
import { buildStockStatus, formatStockStatus, formatMarketCap, type StockStatus } from '../../app/actions/stock/status'
import { scrapeEpsAction } from '../../app/actions/stock/scrape-eps'
import { seedWatchlistAction, type StepOutcome, type SeedWatchlistSummary } from '../../app/actions/stock/seed-watchlist'
import type { CommandResult } from '../command-types'
import { formatCliResultOutput } from '../output'

export interface StockCommandDependencies {
    downloadStockData?: typeof downloadStockDataAction
    buildStockData?: typeof buildStockDataAction
    scrapeEps?: typeof scrapeEpsAction
    seedWatchlist?: typeof seedWatchlistAction
    fetchStockHistory?: typeof buildStockHistory
    fetchStockStatus?: typeof buildStockStatus
    fetchStockList?: typeof buildStockList
}

// Build the CLI message shown when a stock action is skipped because its file already exists.
function skippedMessage(stockCode: string, outputPath: string): string {
    return `Skipped ${stockCode}: ${outputPath} already exists.`
}

// Tally one step's outcomes across every ticker into an "x ok, y skipped, z failed" line.
function summarizeStep(label: string, outcomes: StepOutcome[]): string {
    const count = (outcome: StepOutcome) => outcomes.filter((value) => value === outcome).length

    return `  ${label.padEnd(10)} ${count('ok')} ok, ${count('skipped')} skipped, ${count('failed')} failed`
}

// Build the final multi-line summary printed after a watchlist seed completes.
function summarizeSeed(summary: SeedWatchlistSummary): { output: string; failedCount: number } {
    const failedCount = summary.results.reduce((total, result) => {
        return total + [result.download, result.scrapeEps, result.build].filter((outcome) => outcome === 'failed').length
    }, 0)

    const output = [
        `Seeded ${summary.tickers.length} tickers from ${summary.tickersFile}.`,
        summarizeStep('download', summary.results.map((result) => result.download)),
        summarizeStep('scrape-eps', summary.results.map((result) => result.scrapeEps)),
        summarizeStep('build', summary.results.map((result) => result.build)),
    ].join('\n')

    return { output, failedCount }
}

export const STOCK_HELP_LINES = [
    '  stock download <code>    Download price history from Yahoo Finance',
    '  stock scrape-eps <code>  Scrape TTM Net EPS from Macrotrends into eps.json',
    '  stock build <code>       Combine downloaded history and EPS into data.json',
    '  stock history <code>     Show data.json from its start through the account date',
    '  stock status <code>      Show the stock data for the account simulation date',
    '  stock price <code>       Show just the close and day change for the account date',
    '  stock list               List every available stock code',
    '  stock compare <codes...> Compare several stocks side by side on the account date',
    '  stock screen [filters]   Screen all stocks (--max-pe, --min-pe, --max-price, --min-price, --min-cap, --max-cap (billions), --dividends, --limit)',
    '  stock seed               Run download, scrape-eps, and build for every watchlist ticker',
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
    }
}

// Render comparison rows as an aligned plain-text table.
function formatComparisonTable(rows: ComparisonRow[]): string {
    const header = ['stock', 'close', 'change%', 'market_cap', 'pe_ratio', 'ttm_eps', 'dividend']
    const dataRows = rows.map((row) => [
        row.stockCode,
        formatNumber(row.close),
        row.changePercent === null ? '-' : `${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(2)}%`,
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
    downloadStockData = downloadStockDataAction,
    buildStockData = buildStockDataAction,
    scrapeEps = scrapeEpsAction,
    seedWatchlist = seedWatchlistAction,
    fetchStockHistory = buildStockHistory,
    fetchStockStatus = buildStockStatus,
    fetchStockList = buildStockList,
}: StockCommandDependencies = {}) {
    // Run `stock download <code>` and report the saved history file back to the CLI.
    async function runDownload(args: string[]): Promise<CommandResult> {
        if (args.length !== 1) {
            return { output: 'Usage: stock download <code>', shouldExit: false, exitCode: 1 }
        }

        try {
            const result = await downloadStockData(args[0])

            if (result.skipped) {
                return { output: skippedMessage(result.stockCode, result.outputPath), shouldExit: false, exitCode: 0 }
            }

            return {
                output: [`Downloaded ${result.rowCount} rows for ${result.stockCode}.`, `Saved file: ${result.outputPath}`].join('\n'),
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Download failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `stock build <code>` and report the saved combined data file back to the CLI.
    async function runBuild(args: string[]): Promise<CommandResult> {
        if (args.length !== 1) {
            return { output: 'Usage: stock build <code>', shouldExit: false, exitCode: 1 }
        }

        try {
            const result = await buildStockData(args[0])

            if (result.skipped) {
                return { output: skippedMessage(result.stockCode, result.outputPath), shouldExit: false, exitCode: 0 }
            }

            return {
                output: [`Built ${result.rowCount} rows for ${result.stockCode}.`, `Saved file: ${result.outputPath}`].join('\n'),
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Build failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `stock scrape-eps <code>` and report the saved EPS file back to the CLI.
    async function runScrapeEps(args: string[]): Promise<CommandResult> {
        if (args.length !== 1) {
            return { output: 'Usage: stock scrape-eps <code>', shouldExit: false, exitCode: 1 }
        }

        try {
            const result = await scrapeEps(args[0])

            if (result.skipped) {
                return { output: skippedMessage(result.stockCode, result.outputPath), shouldExit: false, exitCode: 0 }
            }

            return {
                output: [`Scraped ${result.rowCount} EPS rows for ${result.stockCode}.`, `Saved file: ${result.outputPath}`].join('\n'),
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Scrape failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `stock history <code>` and print the saved data series through the account's date.
    async function runHistory(args: string[]): Promise<CommandResult> {
        if (args.length !== 1) {
            return { output: 'Usage: stock history <code>', shouldExit: false, exitCode: 1 }
        }

        try {
            const result = await fetchStockHistory(args[0])

            return { output: formatStockHistory(result), data: result, shouldExit: false, exitCode: 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `History failed: ${message}`, shouldExit: false, exitCode: 1 }
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
        const filters: { maxPe?: number; minPe?: number; maxPrice?: number; minPrice?: number; minCap?: number; maxCap?: number; dividends?: boolean; limit?: number } = {}

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
            } else if (arg.startsWith('--limit=')) {
                filters.limit = Number(arg.slice('--limit='.length))
            } else {
                return { output: `Unknown screen filter: ${arg}`, shouldExit: false, exitCode: 1 }
            }
        }

        try {
            const codes = await fetchStockList()
            let rows: ComparisonRow[] = []

            // Build each stock's snapshot; skip any that have no priced sim-date data rather than failing.
            for (const code of codes) {
                try {
                    rows.push(toComparisonRow(await fetchStockStatus(code)))
                } catch {
                    continue
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

    // Run `stock seed` to process every watchlist ticker, streaming live progress.
    async function runSeed(args: string[]): Promise<CommandResult> {
        if (args.length !== 0) {
            return { output: 'Usage: stock seed', shouldExit: false, exitCode: 1 }
        }

        try {
            const summary = await seedWatchlist((message) => console.log(formatCliResultOutput(message)))
            const { output, failedCount } = summarizeSeed(summary)

            return { output, data: summary, shouldExit: false, exitCode: failedCount > 0 ? 1 : 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Seed failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Execute the `stock` command family and dispatch to its subcommands.
    return async function runStockCommand(args: string[]): Promise<CommandResult> {
        switch (args[0]) {
            case 'download':
                return runDownload(args.slice(1))
            case 'scrape-eps':
                return runScrapeEps(args.slice(1))
            case 'seed':
                return runSeed(args.slice(1))
            case 'build':
                return runBuild(args.slice(1))
            case 'history':
                return runHistory(args.slice(1))
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
                return { output: 'Usage: stock <download <code>|scrape-eps <code>|build <code>|history <code>|status <code>|price <code>|list|compare <codes...>|screen [filters]|seed>', shouldExit: false, exitCode: 1 }
        }
    }
}
