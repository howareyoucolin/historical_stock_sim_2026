import { buildStockDataAction } from '../../app/actions/stock/build-data'
import { downloadStockDataAction } from '../../app/actions/stock/download-data'
import { scrapeEpsAction } from '../../app/actions/stock/scrape-eps'
import { seedWatchlistAction, type StepOutcome, type SeedWatchlistSummary } from '../../app/actions/stock/seed-watchlist'
import type { CommandResult } from '../command-types'
import { formatCliResultOutput } from '../output'

export interface StockCommandDependencies {
    downloadStockData?: typeof downloadStockDataAction
    buildStockData?: typeof buildStockDataAction
    scrapeEps?: typeof scrapeEpsAction
    seedWatchlist?: typeof seedWatchlistAction
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
    '  stock seed               Run download, scrape-eps, and build for every watchlist ticker',
]

// Build the stock command handler so stock-specific workflows live in their own module.
export function createStockCommandHandler({
    downloadStockData = downloadStockDataAction,
    buildStockData = buildStockDataAction,
    scrapeEps = scrapeEpsAction,
    seedWatchlist = seedWatchlistAction,
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

    // Run `stock seed` to process every watchlist ticker, streaming live progress.
    async function runSeed(args: string[]): Promise<CommandResult> {
        if (args.length !== 0) {
            return { output: 'Usage: stock seed', shouldExit: false, exitCode: 1 }
        }

        try {
            const summary = await seedWatchlist((message) => console.log(formatCliResultOutput(message)))
            const { output, failedCount } = summarizeSeed(summary)

            return { output, shouldExit: false, exitCode: failedCount > 0 ? 1 : 0 }
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
            default:
                return { output: 'Usage: stock <download <code>|scrape-eps <code>|build <code>|seed>', shouldExit: false, exitCode: 1 }
        }
    }
}
