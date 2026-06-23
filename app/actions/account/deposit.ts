import { appendHistoryEvent } from '../history/log'
import {
    type AccountSessionDependencies,
    readDefaultUserAccountSession,
    type AccountState,
    writeDefaultUserAccountSession,
} from './model'

// Add a cash delta to the shared default user account and persist the updated session file. An
// optional `note` is recorded on the DEPOSIT history row so contributions can be annotated (e.g.
// "monthly recurring contribution") in the audit trail.
export async function depositIntoDefaultUserAccountSession(
    valueCash: number,
    dependencies: AccountSessionDependencies = {},
    note?: string
): Promise<AccountState> {
    if (!Number.isFinite(valueCash)) {
        throw new Error('Cash delta must be a finite number.')
    }

    const account = await readDefaultUserAccountSession(dependencies)
    const updatedAccount: AccountState = {
        ...account,
        cash: account.cash + valueCash,
    }

    const savedAccount = await writeDefaultUserAccountSession(updatedAccount, dependencies)

    await appendHistoryEvent(
        {
            type: 'DEPOSIT',
            simDate: account.date,
            cashDelta: valueCash,
            note,
        },
        { cwd: dependencies.cwd }
    )

    return savedAccount
}
