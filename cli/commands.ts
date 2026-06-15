import { downloadStockDataAction } from '../app/actions/stock/download-data'
import {
    DEFAULT_USER_SESSION_RELATIVE_PATH,
    initializeDefaultUserAccountSession,
} from '../app/actions/account/session-store'
import type { AccountState } from '../app/actions/account/storage'

export interface CommandResult {
    output: string
    shouldExit: boolean
    exitCode: number
}

interface CommandDependencies {
    downloadStockData?: typeof downloadStockDataAction
    initializeDefaultUserAccount?: () => Promise<AccountState>
}

// Return the shell banner shown when developers enter the CLI realm.
export function getBanner(): string {
    return ['StockSimulate2026 CLI', 'Welcome to the app realm.', 'Type `help` to see available commands.'].join('\n')
}

// Return the help text for all supported CLI commands.
export function getHelpText(): string {
    return [
        'Available commands:',
        '  help                   Show the command list',
        '  account init           Reset the shared account session file',
        '  stock download <code>  Download price history from Yahoo Finance',
        '  exit                   Leave the CLI',
        '  quit                   Leave the CLI',
    ].join('\n')
}

// Normalize raw user input into a command token and its arguments.
export function parseCommand(input: string): { command: string; args: string[] } {
    const parts = input.trim().split(/\s+/).filter(Boolean)

    return {
        command: parts[0] ? parts[0].toLowerCase() : '',
        args: parts.slice(1),
    }
}

// Build the CLI command runner so tests can replace side effects with focused stubs.
export function createRunCommand({
    downloadStockData = downloadStockDataAction,
    initializeDefaultUserAccount = initializeDefaultUserAccountSession,
}: CommandDependencies = {}) {
    // Execute a single CLI command and forward business logic to shared actions.
    return async function runCommand(input: string): Promise<CommandResult> {
        const { command, args } = parseCommand(input)

        if (!command) {
            return { output: '', shouldExit: false, exitCode: 0 }
        }

        switch (command) {
            case 'help':
                return { output: getHelpText(), shouldExit: false, exitCode: 0 }
            case 'account':
                if (args[0] !== 'init' || args.length !== 1) {
                    return {
                        output: 'Usage: account init',
                        shouldExit: false,
                        exitCode: 1,
                    }
                }

                try {
                    const account = await initializeDefaultUserAccount()

                    return {
                        output: [
                            `Reset account in ${DEFAULT_USER_SESSION_RELATIVE_PATH}.`,
                            `Cash: ${account.cash}`,
                            `Tracked symbols: ${Object.keys(account.positions).length}`,
                        ].join('\n'),
                        shouldExit: false,
                        exitCode: 0,
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)

                    return {
                        output: `Account init failed: ${message}`,
                        shouldExit: false,
                        exitCode: 1,
                    }
                }
            case 'stock':
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
            case 'exit':
            case 'quit':
                return { output: 'Leaving StockSimulate2026 CLI.', shouldExit: true, exitCode: 0 }
            default:
                return {
                    output: `Unknown command: ${command}\nType \`help\` to see available commands.`,
                    shouldExit: false,
                    exitCode: 1,
                }
        }
    }
}

export const runCommand = createRunCommand()
