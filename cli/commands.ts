import { createAccountCommandHandler, type AccountCommandDependencies, ACCOUNT_HELP_LINES } from './command-groups/account'
import { createDateCommandHandler, type DateCommandDependencies, DATE_HELP_LINES } from './command-groups/date'
import { createStockCommandHandler, type StockCommandDependencies, STOCK_HELP_LINES } from './command-groups/stock'
import type { CommandResult } from './command-types'

type CommandDependencies = AccountCommandDependencies & DateCommandDependencies & StockCommandDependencies

export type { CommandResult } from './command-types'

// Return the shell banner shown when developers enter the CLI realm.
export function getBanner(): string {
    return ['StockSimulate2026 CLI', 'Welcome to the app realm.', 'Type `help` to see available commands.'].join('\n')
}

// Return the help text for all supported CLI commands.
export function getHelpText(): string {
    return [
        'Available commands:',
        '  help                   Show the command list',
        ...ACCOUNT_HELP_LINES,
        ...DATE_HELP_LINES,
        ...STOCK_HELP_LINES,
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
    downloadStockData,
    buildStockData,
    scrapeEps,
    buyStockInDefaultUserAccount,
    depositIntoDefaultUserAccount,
    initializeDefaultUserAccount,
    showDefaultUserAccount,
    setDefaultUserAccountDateToTomorrow,
    setDefaultUserAccountDateToSpecificDate,
}: CommandDependencies = {}) {
    const runAccountCommand = createAccountCommandHandler({
        buyStockInDefaultUserAccount,
        initializeDefaultUserAccount,
        depositIntoDefaultUserAccount,
        showDefaultUserAccount,
    })
    const runDateCommand = createDateCommandHandler({
        setDefaultUserAccountDateToTomorrow,
        setDefaultUserAccountDateToSpecificDate,
    })
    const runStockCommand = createStockCommandHandler({
        downloadStockData,
        buildStockData,
        scrapeEps,
    })

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
                return runAccountCommand(args)
            case 'date':
                return runDateCommand(args)
            case 'stock':
                return runStockCommand(args)
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
