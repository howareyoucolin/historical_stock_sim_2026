import type { AccountState } from '../account/model'
import { advanceSimulationDate, type AdvanceSimulationDependencies } from './advance'

// Advance the shared simulation date forward to a target day by stepping through each trading
// day, so dividends on every payout date in between are still applied along the way.
export async function setDefaultUserAccountDateToSpecificDate(
    specificDate: string,
    dependencies: AdvanceSimulationDependencies = {}
): Promise<AccountState> {
    const { account } = await advanceSimulationDate(specificDate, dependencies)

    return account
}
