import {
    createDefaultAccountState,
    writeDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
} from './model'

// Reset the shared default user account file through the same account initializer used elsewhere.
export async function initializeDefaultUserAccountSession(
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    return writeDefaultUserAccountSession(createDefaultAccountState(), dependencies)
}
