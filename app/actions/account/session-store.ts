import fs from 'node:fs/promises'
import path from 'node:path'

import {
    ACCOUNT_STORAGE_KEY,
    createDefaultAccountState,
    initializeAccountStorage,
    normalizeAccountState,
    readAccountStorage,
    type AccountState,
    type StorageLike,
} from './storage'

export const USER_SESSIONS_DIRECTORY_NAME = 'user-sessions'
export const DEFAULT_USER_SESSION_FILE_NAME = 'default.json'
export const DEFAULT_USER_SESSION_RELATIVE_PATH = `${USER_SESSIONS_DIRECTORY_NAME}/${DEFAULT_USER_SESSION_FILE_NAME}`

interface SessionStoreDependencies {
    cwd?: () => string
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
    writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
}

// Keep one account object in memory while the file-backed session adapter mutates it.
class UserSessionFileStorage implements StorageLike {
    private constructor(private accountState: unknown | undefined) {}

    // Open the current user session file and fall back to an empty session when it is missing.
    static async open(
        sessionFilePath: string,
        readFile: (path: string, encoding: BufferEncoding) => Promise<string>
    ): Promise<UserSessionFileStorage> {
        try {
            const rawContents = await readFile(sessionFilePath, 'utf8')

            return new UserSessionFileStorage(parseSessionFileContents(rawContents))
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return new UserSessionFileStorage(undefined)
            }

            throw error
        }
    }

    // Return the serialized account value for the shared account storage key.
    getItem(key: string): string | null {
        if (key !== ACCOUNT_STORAGE_KEY || this.accountState === undefined) {
            return null
        }

        return JSON.stringify(this.accountState)
    }

    // Replace the in-memory account object with the latest serialized payload.
    setItem(key: string, value: string): void {
        if (key !== ACCOUNT_STORAGE_KEY) {
            return
        }

        this.accountState = JSON.parse(value)
    }

    // Clear the in-memory account object for the shared account storage key.
    removeItem(key: string): void {
        if (key === ACCOUNT_STORAGE_KEY) {
            this.accountState = undefined
        }
    }

    // Persist the normalized account object back into the shared user session file.
    async save(
        sessionFilePath: string,
        makeDirectory: (path: string, options?: { recursive?: boolean }) => Promise<unknown>,
        writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
    ): Promise<void> {
        await makeDirectory(path.dirname(sessionFilePath), { recursive: true })
        await writeFile(sessionFilePath, `${JSON.stringify(normalizeAccountState(this.accountState), null, 2)}\n`, 'utf8')
    }
}

// Parse a saved session file into an account-shaped object when possible.
function parseSessionFileContents(rawContents: string): unknown {
    try {
        return JSON.parse(rawContents)
    } catch {
        return undefined
    }
}

// Build the absolute path for the default user session file inside the repo.
// TODO: Resolve the target file from a user identifier once we support files like `user_colin.json`.
export function getDefaultUserSessionFilePath(cwd: () => string = process.cwd): string {
    return path.join(cwd(), DEFAULT_USER_SESSION_RELATIVE_PATH)
}

// Read the shared default user account and create the default file if it is missing or invalid.
export async function readDefaultUserAccountSession({
    cwd = process.cwd,
    makeDirectory = fs.mkdir,
    readFile = fs.readFile,
    writeFile = fs.writeFile,
}: SessionStoreDependencies = {}): Promise<AccountState> {
    const sessionFilePath = getDefaultUserSessionFilePath(cwd)
    const storage = await UserSessionFileStorage.open(sessionFilePath, readFile)
    const account = readAccountStorage(storage)

    if (storage.getItem(ACCOUNT_STORAGE_KEY) === null) {
        initializeAccountStorage(storage)
        await storage.save(sessionFilePath, makeDirectory, writeFile)
        return createDefaultAccountState()
    }

    return account
}

// Reset the shared default user account file through the same account initializer used elsewhere.
export async function initializeDefaultUserAccountSession({
    cwd = process.cwd,
    makeDirectory = fs.mkdir,
    readFile = fs.readFile,
    writeFile = fs.writeFile,
}: SessionStoreDependencies = {}): Promise<AccountState> {
    const sessionFilePath = getDefaultUserSessionFilePath(cwd)
    const storage = await UserSessionFileStorage.open(sessionFilePath, readFile)
    const account = initializeAccountStorage(storage)

    await storage.save(sessionFilePath, makeDirectory, writeFile)

    return account
}
