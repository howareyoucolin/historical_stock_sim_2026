import fs from 'node:fs/promises'
import path from 'node:path'

import { createDefaultAccountState, DEFAULT_ACCOUNT_DATE, normalizeAccountState, type AccountState } from './state'
import { accountSessionFileName, USER_SESSIONS_DIRECTORY_NAME } from '../session'

export { createDefaultAccountState, DEFAULT_ACCOUNT_DATE, normalizeAccountState, type AccountPosition, type AccountState } from './state'

export { USER_SESSIONS_DIRECTORY_NAME } from '../session'
export const DEFAULT_USER_SESSION_FILE_NAME = 'default.json'
export const DEFAULT_USER_SESSION_RELATIVE_PATH = `${USER_SESSIONS_DIRECTORY_NAME}/${DEFAULT_USER_SESSION_FILE_NAME}`

// Repo-relative path of the account file for the currently active session (session-aware).
function sessionRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${accountSessionFileName()}`
}

export interface AccountSessionDependencies {
    cwd?: () => string
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
    writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
}

// Read the shared default user account and create the default file if it is missing.
export async function readDefaultUserAccountSession({
    cwd = process.cwd,
    makeDirectory = fs.mkdir,
    readFile = fs.readFile,
    writeFile = fs.writeFile,
}: AccountSessionDependencies = {}): Promise<AccountState> {
    const sessionFilePath = path.join(cwd(), sessionRelativePath())

    try {
        const parsedAccount = JSON.parse(await readFile(sessionFilePath, 'utf8')) as Partial<AccountState>

        return normalizeAccountState(parsedAccount)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            const defaultAccountState = createDefaultAccountState()
            await writeDefaultUserAccountSession(defaultAccountState, {
                cwd,
                makeDirectory,
                writeFile,
            })

            return defaultAccountState
        }

        if (error instanceof SyntaxError) {
            throw new Error(`Invalid account session JSON: ${error.message}`)
        }

        throw error
    }
}

// Write the shared default user account into `user-sessions/default.json`.
export async function writeDefaultUserAccountSession(
    account: AccountState,
    {
        cwd = process.cwd,
        makeDirectory = fs.mkdir,
        writeFile = fs.writeFile,
    }: AccountSessionDependencies = {}
): Promise<AccountState> {
    const sessionFilePath = path.join(cwd(), sessionRelativePath())

    await makeDirectory(path.dirname(sessionFilePath), { recursive: true })
    await writeFile(sessionFilePath, `${JSON.stringify(account, null, 2)}\n`, 'utf8')

    return account
}
