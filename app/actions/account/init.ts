import fs from 'node:fs/promises'
import path from 'node:path'

import {
    createDefaultAccountState,
    USER_SESSIONS_DIRECTORY_NAME,
    writeDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
} from './model'
import {
    legacyAccountSessionFileName,
    legacyFlatAccountDataFileName,
    legacyFlatAccountMetaFileName,
    sessionFolderName,
} from '../session'

// Remove every entry in the user-sessions directory so a reset starts from a truly empty slate,
// deleting ALL sessions (every folder + any legacy flat files). Exported for a full wipe; normal
// `account init` is scoped to a single session (see below). A missing directory is already empty.
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

// Reset ONLY the active session, leaving every other session untouched: remove its folder plus any
// leftover legacy flat files for the same name. This is the reset scope for both the default and named
// sessions now that each session is isolated in its own folder.
export async function resetActiveSessionFiles(cwd: () => string = process.cwd): Promise<void> {
    const sessionsDirectory = path.join(cwd(), USER_SESSIONS_DIRECTORY_NAME)
    const targets = [
        sessionFolderName(),
        legacyFlatAccountDataFileName(),
        legacyFlatAccountMetaFileName(),
        legacyAccountSessionFileName(),
    ]

    await Promise.all(targets.map((target) => fs.rm(path.join(sessionsDirectory, target), { recursive: true, force: true })))
}

// Reset the active session to a clean starting state, then write its fresh default account. Scoped to
// the active session's own folder so it never disturbs sibling sessions (use emptyUserSessionsDirectory
// for a full wipe of everything).
export async function initializeDefaultUserAccountSession(
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    await resetActiveSessionFiles(dependencies.cwd)

    return writeDefaultUserAccountSession(createDefaultAccountState(), dependencies)
}
