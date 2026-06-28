import fs from 'node:fs/promises'
import path from 'node:path'

import {
    createDefaultAccountState,
    USER_SESSIONS_DIRECTORY_NAME,
    writeDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
} from './model'

// Remove every file in the user-sessions directory so a reset starts from a truly empty slate. This
// clears the default session (account, meta, history log, value log, report) AND any named sessions,
// not just the default one. A missing directory is treated as already empty.
export async function emptyUserSessionsDirectory(cwd: () => string = process.cwd): Promise<void> {
    const sessionsDirectory = path.join(cwd(), USER_SESSIONS_DIRECTORY_NAME)

    let entries: string[]

    try {
        entries = await fs.readdir(sessionsDirectory)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return
        }

        throw error
    }

    await Promise.all(entries.map((entry) => fs.rm(path.join(sessionsDirectory, entry), { recursive: true, force: true })))
}

// Reset the simulator to a clean slate: empty the entire user-sessions directory (every session,
// log, and report), then write a fresh default account so the app has a valid starting state.
export async function initializeDefaultUserAccountSession(
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    await emptyUserSessionsDirectory(dependencies.cwd)

    return writeDefaultUserAccountSession(createDefaultAccountState(), dependencies)
}
