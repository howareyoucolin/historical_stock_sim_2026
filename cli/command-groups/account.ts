import {
    DEFAULT_USER_SESSION_RELATIVE_PATH,
    type AccountState,
} from '../../app/actions/account/model'
import { depositIntoDefaultUserAccountSession } from '../../app/actions/account/deposit'
import { initializeDefaultUserAccountSession } from '../../app/actions/account/init'
import type { CommandResult } from '../command-types'

export interface AccountCommandDependencies {
    initializeDefaultUserAccount?: () => Promise<AccountState>
    depositIntoDefaultUserAccount?: (valueCash: number) => Promise<AccountState>
}

export const ACCOUNT_HELP_LINES = [
    '  account deposit <cash> Add cash to the shared account session file',
    '  account init           Reset the shared account session file',
]

// Build the short account summary shown after CLI account mutations succeed.
function formatAccountSummary(prefix: string, account: AccountState): string {
    return [prefix, `Cash: ${account.cash}`, `Tracked symbols: ${Object.keys(account.positions).length}`].join('\n')
}

// Build the account command handler so account-specific behavior stays out of the main router.
export function createAccountCommandHandler({
    initializeDefaultUserAccount = initializeDefaultUserAccountSession,
    depositIntoDefaultUserAccount = depositIntoDefaultUserAccountSession,
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

        if (args[0] === 'deposit') {
            return {
                output: 'Usage: account deposit <value_cash>',
                shouldExit: false,
                exitCode: 1,
            }
        }

        return {
            output: args[0] ? 'Usage: account <init|deposit <value_cash>>' : 'Usage: account init',
            shouldExit: false,
            exitCode: 1,
        }
    }
}
