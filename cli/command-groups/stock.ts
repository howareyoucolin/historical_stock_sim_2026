import { buildStockDataAction } from '../../app/actions/stock/build-data'
import { downloadStockDataAction } from '../../app/actions/stock/download-data'
import type { CommandResult } from '../command-types'

export interface StockCommandDependencies {
    downloadStockData?: typeof downloadStockDataAction
    buildStockData?: typeof buildStockDataAction
}

export const STOCK_HELP_LINES = [
    '  stock download <code>  Download price history from Yahoo Finance',
    '  stock build <code>     Combine downloaded history and EPS into data.json',
]

// Build the stock command handler so stock-specific workflows live in their own module.
export function createStockCommandHandler({
    downloadStockData = downloadStockDataAction,
    buildStockData = buildStockDataAction,
}: StockCommandDependencies = {}) {
    // Run `stock download <code>` and report the saved history file back to the CLI.
    async function runDownload(args: string[]): Promise<CommandResult> {
        if (args.length !== 1) {
            return { output: 'Usage: stock download <code>', shouldExit: false, exitCode: 1 }
        }

        try {
            const result = await downloadStockData(args[0])

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

    // Execute the `stock` command family and dispatch to its subcommands.
    return async function runStockCommand(args: string[]): Promise<CommandResult> {
        switch (args[0]) {
            case 'download':
                return runDownload(args.slice(1))
            case 'build':
                return runBuild(args.slice(1))
            default:
                return { output: 'Usage: stock <download|build> <code>', shouldExit: false, exitCode: 1 }
        }
    }
}
