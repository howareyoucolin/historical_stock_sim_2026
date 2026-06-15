import { downloadStockDataAction } from '../../app/actions/stock/download-data'
import type { CommandResult } from '../command-types'

export interface StockCommandDependencies {
    downloadStockData?: typeof downloadStockDataAction
}

export const STOCK_HELP_LINES = ['  stock download <code>  Download price history from Yahoo Finance']

// Build the stock command handler so stock-specific workflows live in their own module.
export function createStockCommandHandler({ downloadStockData = downloadStockDataAction }: StockCommandDependencies = {}) {
    // Execute the `stock` command family and report download results back to the CLI.
    return async function runStockCommand(args: string[]): Promise<CommandResult> {
        if (args[0] !== 'download' || args.length !== 2) {
            return {
                output: 'Usage: stock download <code>',
                shouldExit: false,
                exitCode: 1,
            }
        }

        try {
            const result = await downloadStockData(args[1])

            return {
                output: [`Downloaded ${result.rowCount} rows for ${result.stockCode}.`, `Saved file: ${result.outputPath}`].join('\n'),
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return {
                output: `Download failed: ${message}`,
                shouldExit: false,
                exitCode: 1,
            }
        }
    }
}
