import type { AccountState } from '../account/model'
import { advanceSimulationDate, type AdvanceSimulationDependencies } from './advance'

export { TRADING_CALENDAR_STOCK_CODE } from './advance'

// Advance the shared simulation date to the next market trading day, crediting any dividends paid that day.
export async function setDefaultUserAccountDateToTomorrow(dependencies: AdvanceSimulationDependencies = {}): Promise<AccountState> {
    const { account } = await advanceSimulationDate(null, dependencies)

    return account
}
