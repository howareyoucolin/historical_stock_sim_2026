import { createAccountCommandHandler, type AccountCommandDependencies, ACCOUNT_HELP_LINES } from './command-groups/account'
import { createDateCommandHandler, type DateCommandDependencies, DATE_HELP_LINES } from './command-groups/date'
import { createHistoryCommandHandler, type HistoryCommandDependencies, HISTORY_HELP_LINES } from './command-groups/history'
import { createReportCommandHandler, type ReportCommandDependencies, REPORT_HELP_LINES } from './command-groups/report'
import { createStockCommandHandler, type StockCommandDependencies, STOCK_HELP_LINES } from './command-groups/stock'
import { createValuesCommandHandler, type ValuesCommandDependencies, VALUES_HELP_LINES } from './command-groups/values'
import { setActiveSession } from '../app/actions/session'
import type { CommandResult } from './command-types'

type CommandDependencies = AccountCommandDependencies &
    DateCommandDependencies &
    HistoryCommandDependencies &
    ReportCommandDependencies &
    StockCommandDependencies &
    ValuesCommandDependencies

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
        ...HISTORY_HELP_LINES,
        ...REPORT_HELP_LINES,
        ...STOCK_HELP_LINES,
        ...VALUES_HELP_LINES,
        '  exit                   Leave the CLI',
        '  quit                   Leave the CLI',
    ].join('\n')
}

// Split raw input into tokens on whitespace while keeping single- or double-quoted spans together
// (with the surrounding quotes stripped), so a flag like `--note="buy the dip"` stays one token.
export function tokenizeCommand(input: string): string[] {
    const tokens: string[] = []
    let current = ''
    let hasToken = false
    let quote: string | null = null

    for (const char of input) {
        if (quote) {
            if (char === quote) {
                quote = null
            } else {
                current += char
            }
            continue
        }

        if (char === '"' || char === "'") {
            quote = char
            hasToken = true
            continue
        }

        if (/\s/.test(char)) {
            if (hasToken) {
                tokens.push(current)
                current = ''
                hasToken = false
            }
            continue
        }

        current += char
        hasToken = true
    }

    if (hasToken) {
        tokens.push(current)
    }

    return tokens
}

// Normalize raw user input into a command token and its arguments.
export function parseCommand(input: string): { command: string; args: string[] } {
    const parts = tokenizeCommand(input)

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
    seedWatchlist,
    buyStockInDefaultUserAccount,
    sellStockInDefaultUserAccount,
    depositIntoDefaultUserAccount,
    initializeDefaultUserAccount,
    fetchAccountView,
    quoteStockForAccountDate,
    advanceOneTradingDay,
    advanceToSpecificDate,
    fetchAccountSession,
    readHistoryEntries,
    buildReport,
    fetchStockHistory,
    fetchStockInfo,
    fetchStockStatus,
    fetchStockList,
    fetchValuesSummary,
}: CommandDependencies = {}) {
    const runAccountCommand = createAccountCommandHandler({
        buyStockInDefaultUserAccount,
        sellStockInDefaultUserAccount,
        initializeDefaultUserAccount,
        depositIntoDefaultUserAccount,
        fetchAccountView,
        quoteStockForAccountDate,
    })
    const runDateCommand = createDateCommandHandler({
        advanceOneTradingDay,
        advanceToSpecificDate,
        fetchAccountSession,
    })
    const runHistoryCommand = createHistoryCommandHandler({
        readHistoryEntries,
    })
    const runReportCommand = createReportCommandHandler({
        buildReport,
    })
    const runStockCommand = createStockCommandHandler({
        downloadStockData,
        buildStockData,
        scrapeEps,
        seedWatchlist,
        fetchStockHistory,
        fetchStockInfo,
        fetchStockStatus,
        fetchStockList,
    })
    const runValuesCommand = createValuesCommandHandler({
        fetchValuesSummary,
    })

    // Dispatch a parsed command (with the global --json flag already stripped) to its handler.
    async function dispatch(command: string, args: string[]): Promise<CommandResult> {
        switch (command) {
            case 'help':
                return { output: getHelpText(), shouldExit: false, exitCode: 0 }
            case 'account':
                return runAccountCommand(args)
            case 'date':
                return runDateCommand(args)
            case 'history':
                return runHistoryCommand(args)
            case 'report':
                return runReportCommand(args)
            case 'stock':
                return runStockCommand(args)
            case 'values':
                return runValuesCommand(args)
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

    // Render a result as JSON: prefer its structured `data`, otherwise wrap the human output as a
    // message (success) or error (failure) so every command yields parseable JSON in --json mode.
    function renderJson(result: CommandResult): CommandResult {
        const payload = result.data !== undefined ? result.data : result.exitCode === 0 ? { message: result.output } : { error: result.output }

        return { ...result, output: JSON.stringify(payload, null, 2), json: true }
    }

    // Execute a single CLI command and forward business logic to shared actions. A global `--json`
    // flag (anywhere in the input) switches output to a structured JSON payload.
    return async function runCommand(input: string): Promise<CommandResult> {
        const { command, args } = parseCommand(input)

        if (!command) {
            return { output: '', shouldExit: false, exitCode: 0 }
        }

        const jsonMode = args.includes('--json')
        const sessionArg = args.find((arg) => arg.startsWith('--session='))
        const cleanArgs = args.filter((arg) => arg !== '--json' && !arg.startsWith('--session='))

        // Point the account actions at the named session's files for this command only, then restore
        // the default so the interactive shell never leaks a session into the next line.
        setActiveSession(sessionArg ? sessionArg.slice('--session='.length) : null)

        let result: CommandResult
        try {
            result = await dispatch(command, cleanArgs)
        } finally {
            setActiveSession(null)
        }

        return jsonMode ? renderJson(result) : result
    }
}

export const runCommand = createRunCommand()
