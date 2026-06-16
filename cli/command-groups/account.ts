import {
    DEFAULT_USER_SESSION_RELATIVE_PATH,
    type AccountState,
} from '../../app/actions/account/model'
import { buyStockInDefaultUserAccountSession, type BuyStockResult } from '../../app/actions/account/buy'
import { sellStockInDefaultUserAccountSession, type SellStockResult } from '../../app/actions/account/sell'
import { depositIntoDefaultUserAccountSession } from '../../app/actions/account/deposit'
import { initializeDefaultUserAccountSession } from '../../app/actions/account/init'
import { showDefaultUserAccountSession } from '../../app/actions/account/show'
import type { CommandResult } from '../command-types'

export interface AccountCommandDependencies {
    initializeDefaultUserAccount?: () => Promise<AccountState>
    showDefaultUserAccount?: () => Promise<string>
    depositIntoDefaultUserAccount?: (valueCash: number) => Promise<AccountState>
    buyStockInDefaultUserAccount?: (stockCode: string, quantity: number) => Promise<BuyStockResult>
    sellStockInDefaultUserAccount?: (stockCode: string, quantity: number) => Promise<SellStockResult>
}

export const ACCOUNT_HELP_LINES = [
    '  account buy <code> <qty> Buy shares using downloaded local history data',
    '  account sell <code> <qty> Sell shares using downloaded local history data',
    '  account deposit <cash> Add cash to the shared account session file',
    '  account init           Reset the shared account session file',
    '  account show           Show the tracked stock table for the shared account',
]

// Format a numeric dollar amount so CLI output stays consistent for account actions.
function formatCurrency(value: number): string {
    return value.toFixed(2)
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

        if (args[0] === 'buy' && args.length === 3) {
            const quantity = Number(args[2])

            if (!Number.isInteger(quantity) || quantity <= 0) {
                return {
                    output: 'Quantity must be a positive integer.',
                    shouldExit: false,
                    exitCode: 1,
                }
            }

            try {
                const result = await buyStockInDefaultUserAccount(args[1], quantity)

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

        if (args[0] === 'sell' && args.length === 3) {
            const quantity = Number(args[2])

            if (!Number.isInteger(quantity) || quantity <= 0) {
                return {
                    output: 'Quantity must be a positive integer.',
                    shouldExit: false,
                    exitCode: 1,
                }
            }

            try {
                const result = await sellStockInDefaultUserAccount(args[1], quantity)

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

        if (args[0] === 'buy') {
            return {
                output: 'Usage: account buy <stock_code> <quantity>',
                shouldExit: false,
                exitCode: 1,
            }
        }

        if (args[0] === 'sell') {
            return {
                output: 'Usage: account sell <stock_code> <quantity>',
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
