import {
    readDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
    writeDefaultUserAccountSession,
} from '../account/model'
import { normalizeSimulationDate } from './utils'

// Set the shared simulation date to a specific ISO day and persist the updated session.
export async function setDefaultUserAccountDateToSpecificDate(
    specificDate: string,
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    const account = await readDefaultUserAccountSession(dependencies)
    const normalizedSpecificDate = normalizeSimulationDate(specificDate)

    if (normalizedSpecificDate < account.date) {
        throw new Error(`Simulation date cannot move backward from ${account.date}.`)
    }

    const updatedAccount: AccountState = {
        ...account,
        date: normalizedSpecificDate,
    }

    return writeDefaultUserAccountSession(updatedAccount, dependencies)
}
