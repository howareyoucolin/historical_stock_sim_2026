import {
    type AccountSessionDependencies,
    readDefaultUserAccountSession,
    type AccountState,
    writeDefaultUserAccountSession,
} from './model'

// Add a cash delta to the shared default user account and persist the updated session file.
export async function depositIntoDefaultUserAccountSession(
    valueCash: number,
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    if (!Number.isFinite(valueCash)) {
        throw new Error('Cash delta must be a finite number.')
    }

    const account = await readDefaultUserAccountSession(dependencies)
    const updatedAccount: AccountState = {
        ...account,
        cash: account.cash + valueCash,
    }

    return writeDefaultUserAccountSession(updatedAccount, dependencies)
}
