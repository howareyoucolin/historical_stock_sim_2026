import {
    DEFAULT_USER_SESSION_RELATIVE_PATH,
    type AccountState,
} from '../../app/actions/account/model'
import { buyStockInDefaultUserAccountSession } from '../../app/actions/account/buy'
import { sellStockInDefaultUserAccountSession } from '../../app/actions/account/sell'
import { depositIntoDefaultUserAccountSession } from '../../app/actions/account/deposit'
import { initializeDefaultUserAccountSession } from '../../app/actions/account/init'
import { showDefaultUserAccountSession } from '../../app/actions/account/show'
import type { CommandResult } from '../command-types'

export interface AccountCommandDependencies {
    initializeDefaultUserAccount?: () => Promise<AccountState>
    showDefaultUserAccount?: () => Promise<string>
    depositIntoDefaultUserAccount?: (valueCash: number) => Promise<AccountState>
    buyStockInDefaultUserAccount?: typeof buyStockInDefaultUserAccountSession
    sellStockInDefaultUserAccount?: typeof sellStockInDefaultUserAccountSession
}

export const ACCOUNT_HELP_LINES = [
    '  account buy <code> <qty> Buy shares; optional --note=<text> recorded in history',
    '  account sell <code> <qty> Sell shares; optional --note=<text> recorded in history',
    '  account deposit <cash> Add cash to the shared account session file',
    '  account init           Reset the shared account session file',
    '  account show           Show the tracked stock table for the shared account',
]

// Format a numeric dollar amount so CLI output stays consistent for account actions.
function formatCurrency(value: number): string {
    return value.toFixed(2)
}

const NOTE_FLAG_PREFIX = '--note='

// Pull an optional `--note=<text>` flag out of trade args, returning the note (when non-empty) and
// the remaining positional args so the buy/sell handlers can validate the positional count cleanly.
function extractNote(args: string[]): { note?: string; positional: string[] } {
    const noteArg = args.find((arg) => arg.startsWith(NOTE_FLAG_PREFIX))
    const positional = args.filter((arg) => !arg.startsWith(NOTE_FLAG_PREFIX))
    const noteText = noteArg ? noteArg.slice(NOTE_FLAG_PREFIX.length) : ''

    return { note: noteText.length > 0 ? noteText : undefined, positional }
}

// Build the account command handler so account-specific behavior stays out of the main router.
export function createAccountCommandHandler({
    initializeDefaultUserAccount = initializeDefaultUserAccountSession,
    showDefaultUserAccount = showDefaultUserAccountSession,
    depositIntoDefaultUserAccount = depositIntoDefaultUserAccountSession,
    buyStockInDefaultUserAccount = buyStockInDefaultUserAccountSession,
    sellStockInDefaultUserAccount = sellStockInDefaultUserAccountSession,
}: AccountCommandDependencies = {}) {
    // Execute the `account` command family against the shared account session file.
    return async function runAccountCommand(args: string[]): Promise<CommandResult> {
        if (args[0] === 'init' && args.length === 1) {
            try {
                await initializeDefaultUserAccount()

                return {
                    output: `Reset account in ${DEFAULT_USER_SESSION_RELATIVE_PATH}.`,
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
        }

        if (args[0] === 'show' && args.length === 1) {
            try {
                const tableOutput = await showDefaultUserAccount()

                return {
                    output: tableOutput,
                    shouldExit: false,
                    exitCode: 0,
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                return {
                    output: `Account show failed: ${message}`,
                    shouldExit: false,
                    exitCode: 1,
                }
            }
        }

        if (args[0] === 'deposit' && args.length === 2) {
            const valueCash = Number(args[1])

            if (!Number.isFinite(valueCash)) {
                return {
                    output: 'Cash value must be a finite number.',
                    shouldExit: false,
                    exitCode: 1,
                }
            }

            try {
                await depositIntoDefaultUserAccount(valueCash)

                return {
                    output: `Updated account cash by ${formatCurrency(valueCash)} in ${DEFAULT_USER_SESSION_RELATIVE_PATH}.`,
                    shouldExit: false,
                    exitCode: 0,
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                return {
                    output: `Account deposit failed: ${message}`,
                    shouldExit: false,
                    exitCode: 1,
                }
            }
        }

        if (args[0] === 'buy') {
            const { note, positional } = extractNote(args)

            if (positional.length !== 3) {
                return {
                    output: 'Usage: account buy <stock_code> <quantity> [--note=<text>]',
                    shouldExit: false,
                    exitCode: 1,
                }
            }

            const quantity = Number(positional[2])

            if (!Number.isInteger(quantity) || quantity <= 0) {
                return {
                    output: 'Quantity must be a positive integer.',
                    shouldExit: false,
                    exitCode: 1,
                }
            }

            try {
                const result = await buyStockInDefaultUserAccount(positional[1], quantity, undefined, note)

                return {
                    output: `${result.quantity} stocks of ${result.stockCode} successfully bought.`,
                    shouldExit: false,
                    exitCode: 0,
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                return {
                    output: `Account buy failed: ${message}`,
                    shouldExit: false,
                    exitCode: 1,
                }
            }
        }

        if (args[0] === 'sell') {
            const { note, positional } = extractNote(args)

            if (positional.length !== 3) {
                return {
                    output: 'Usage: account sell <stock_code> <quantity> [--note=<text>]',
                    shouldExit: false,
                    exitCode: 1,
                }
            }

            const quantity = Number(positional[2])

            if (!Number.isInteger(quantity) || quantity <= 0) {
                return {
                    output: 'Quantity must be a positive integer.',
                    shouldExit: false,
                    exitCode: 1,
                }
            }

            try {
                const result = await sellStockInDefaultUserAccount(positional[1], quantity, undefined, note)

                return {
                    output: `${result.quantity} stocks of ${result.stockCode} successfully sold.`,
                    shouldExit: false,
                    exitCode: 0,
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                return {
                    output: `Account sell failed: ${message}`,
                    shouldExit: false,
                    exitCode: 1,
                }
            }
        }

        if (args[0] === 'deposit') {
            return {
                output: 'Usage: account deposit <value_cash>',
                shouldExit: false,
                exitCode: 1,
            }
        }

        if (args[0] === 'show') {
            return {
                output: 'Usage: account show',
                shouldExit: false,
                exitCode: 1,
            }
        }

        return {
            output: 'Usage: account <init|show|deposit <value_cash>|buy <stock_code> <quantity>|sell <stock_code> <quantity>>',
            shouldExit: false,
            exitCode: 1,
        }
    }
}
