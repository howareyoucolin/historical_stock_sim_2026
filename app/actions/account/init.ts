import { clearHistoryLog } from '../history/log'
import {
    createDefaultAccountState,
    writeDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
} from './model'

// Reset the shared default user account file and wipe the history log so the audit trail matches
// the freshly reset account state.
export async function initializeDefaultUserAccountSession(
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    const account = await writeDefaultUserAccountSession(createDefaultAccountState(), dependencies)

    await clearHistoryLog({ cwd: dependencies.cwd })

    return account
}
