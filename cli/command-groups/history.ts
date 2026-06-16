import { showHistoryLog } from '../../app/actions/history/log'
import type { CommandResult } from '../command-types'

export interface HistoryCommandDependencies {
    showHistoryLog?: () => Promise<string>
}

export const HISTORY_HELP_LINES = [
    '  history show           Show the logged buys, sells, dividends, and deposits',
]

// Build the history command handler so history-log behavior stays out of the main router.
export function createHistoryCommandHandler({
    showHistoryLog: showHistory = showHistoryLog,
}: HistoryCommandDependencies = {}) {
    // Execute the `history` command family against the shared history log file.
    return async function runHistoryCommand(args: string[]): Promise<CommandResult> {
        if (args[0] === 'show' && args.length === 1) {
            try {
                const output = await showHistory()

                return {
                    output,
                    shouldExit: false,
                    exitCode: 0,
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                return {
                    output: `History show failed: ${message}`,
                    shouldExit: false,
                    exitCode: 1,
                }
            }
        }

        return {
            output: 'Usage: history show',
            shouldExit: false,
            exitCode: 1,
        }
    }
}
