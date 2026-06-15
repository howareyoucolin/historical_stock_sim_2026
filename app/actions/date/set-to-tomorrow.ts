import {
    readDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
    writeDefaultUserAccountSession,
} from '../account/model'
import { addDaysToSimulationDate } from './utils'

// Advance the shared simulation date by one calendar day and persist the updated session.
export async function setDefaultUserAccountDateToTomorrow(
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    const account = await readDefaultUserAccountSession(dependencies)
    const updatedAccount: AccountState = {
        ...account,
        date: addDaysToSimulationDate(account.date, 1),
    }

    return writeDefaultUserAccountSession(updatedAccount, dependencies)
}
