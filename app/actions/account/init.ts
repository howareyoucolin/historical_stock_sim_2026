import { clearHistoryLog } from '../history/log'
import { clearValueLog } from './values-log'
import {
    createDefaultAccountState,
    writeDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
} from './model'

// Reset the shared default user account file and wipe both the history log and the daily value log
// so the audit trail and value graph match the freshly reset account state.
export async function initializeDefaultUserAccountSession(
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    const account = await writeDefaultUserAccountSession(createDefaultAccountState(), dependencies)

    await clearHistoryLog({ cwd: dependencies.cwd })
    await clearValueLog({ cwd: dependencies.cwd })

    return account
}
