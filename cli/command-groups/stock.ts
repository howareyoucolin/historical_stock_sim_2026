import { buildStockDataAction } from '../../app/actions/stock/build-data'
import { downloadStockDataAction } from '../../app/actions/stock/download-data'
import { scrapeEpsAction } from '../../app/actions/stock/scrape-eps'
import type { CommandResult } from '../command-types'

export interface StockCommandDependencies {
    downloadStockData?: typeof downloadStockDataAction
    buildStockData?: typeof buildStockDataAction
    scrapeEps?: typeof scrapeEpsAction
}

// Build the CLI message shown when a stock action is skipped because its file already exists.
function skippedMessage(stockCode: string, outputPath: string): string {
    return `Skipped ${stockCode}: ${outputPath} already exists.`
}

export const STOCK_HELP_LINES = [
    '  stock download <code>    Download price history from Yahoo Finance',
    '  stock scrape-eps <code>  Scrape TTM Net EPS from Macrotrends into eps.json',
    '  stock build <code>       Combine downloaded history and EPS into data.json',
]

// Build the stock command handler so stock-specific workflows live in their own module.
export function createStockCommandHandler({
    downloadStockData = downloadStockDataAction,
    buildStockData = buildStockDataAction,
    scrapeEps = scrapeEpsAction,
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

    // Execute the `stock` command family and dispatch to its subcommands.
    return async function runStockCommand(args: string[]): Promise<CommandResult> {
        switch (args[0]) {
            case 'download':
                return runDownload(args.slice(1))
            case 'scrape-eps':
                return runScrapeEps(args.slice(1))
            case 'build':
                return runBuild(args.slice(1))
            default:
                return { output: 'Usage: stock <download|scrape-eps|build> <code>', shouldExit: false, exitCode: 1 }
        }
    }
}
