import {
    DEFAULT_USER_SESSION_RELATIVE_PATH,
    type AccountState,
} from '../../app/actions/account/model'
import { buyStockInDefaultUserAccountSession, type BuyStockResult } from '../../app/actions/account/buy'
import { depositIntoDefaultUserAccountSession } from '../../app/actions/account/deposit'
import { initializeDefaultUserAccountSession } from '../../app/actions/account/init'
import type { CommandResult } from '../command-types'

export interface AccountCommandDependencies {
    initializeDefaultUserAccount?: () => Promise<AccountState>
    depositIntoDefaultUserAccount?: (valueCash: number) => Promise<AccountState>
    buyStockInDefaultUserAccount?: (stockCode: string, quantity: number) => Promise<BuyStockResult>
}

export const ACCOUNT_HELP_LINES = [
    '  account buy <code> <qty> Buy shares using downloaded local history data',
    '  account deposit <cash> Add cash to the shared account session file',
    '  account init           Reset the shared account session file',
]

// Format a numeric dollar amount so CLI output stays consistent for account actions.
function formatCurrency(value: number): string {
    return value.toFixed(2)
}

// Build a display-only view of tracked positions with readable currency formatting for terminal output.
function formatTrackedSymbols(positions: AccountState['positions']): string {
    const formattedPositions = Object.fromEntries(
        Object.entries(positions).map(([stockCode, stockPositions]) => [
            stockCode,
            stockPositions.map((position) => ({
                ...position,
                cost_per_share: formatCurrency(position.cost_per_share),
            })),
        ])
    )

    return JSON.stringify(formattedPositions, null, 2)
}

// Build the shared account detail lines used by CLI account command success messages.
function formatAccountDetails(account: AccountState): string[] {
    return [`Date: ${account.date}`, `Cash: ${formatCurrency(account.cash)}`, `Tracked symbols:\n${formatTrackedSymbols(account.positions)}`]
}

// Build the short account summary shown after CLI account mutations succeed.
function formatAccountSummary(prefix: string, account: AccountState): string {
    return [prefix, ...formatAccountDetails(account)].join('\n')
}

// Build the account command handler so account-specific behavior stays out of the main router.
export function createAccountCommandHandler({
    initializeDefaultUserAccount = initializeDefaultUserAccountSession,
    depositIntoDefaultUserAccount = depositIntoDefaultUserAccountSession,
    buyStockInDefaultUserAccount = buyStockInDefaultUserAccountSession,
}: AccountCommandDependencies = {}) {
    // Execute the `account` command family against the shared account session file.
    return async function runAccountCommand(args: string[]): Promise<CommandResult> {
        if (args[0] === 'init' && args.length === 1) {
            try {
                const account = await initializeDefaultUserAccount()

                return {
                    output: formatAccountSummary(`Reset account in ${DEFAULT_USER_SESSION_RELATIVE_PATH}.`, account),
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
                const account = await depositIntoDefaultUserAccount(valueCash)

                return {
                    output: formatAccountSummary(`Updated account in ${DEFAULT_USER_SESSION_RELATIVE_PATH}.`, account),
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
                    output: [
                        `Bought ${result.quantity} shares of ${result.stockCode} at ${formatCurrency(result.costPerShare)} in ${DEFAULT_USER_SESSION_RELATIVE_PATH}.`,
                        `Total cost: ${formatCurrency(result.totalCost)}`,
                        ...formatAccountDetails(result.account),
                    ].join('\n'),
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

        if (args[0] === 'deposit') {
            return {
                output: 'Usage: account deposit <value_cash>',
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

        return {
            output: args[0] ? 'Usage: account <init|deposit <value_cash>|buy <stock_code> <quantity>>' : 'Usage: account init',
            shouldExit: false,
            exitCode: 1,
        }
    }
}
