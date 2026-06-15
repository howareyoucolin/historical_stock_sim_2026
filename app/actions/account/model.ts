import fs from 'node:fs/promises'
import path from 'node:path'

export interface AccountPosition {
    quantity: number
    cost_per_share: number
    purchase_date: string
}

export interface AccountState {
    date: string
    cash: number
    positions: Record<string, AccountPosition[]>
}

export const USER_SESSIONS_DIRECTORY_NAME = 'user-sessions'
export const DEFAULT_USER_SESSION_FILE_NAME = 'default.json'
export const DEFAULT_USER_SESSION_RELATIVE_PATH = `${USER_SESSIONS_DIRECTORY_NAME}/${DEFAULT_USER_SESSION_FILE_NAME}`
export const DEFAULT_ACCOUNT_DATE = '2016-01-01'

export interface AccountSessionDependencies {
    cwd?: () => string
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
    writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
}

// Build a fresh default account object so callers never share mutable nested state.
export function createDefaultAccountState(): AccountState {
    return {
        date: DEFAULT_ACCOUNT_DATE,
        cash: 0,
        positions: {},
    }
}

// Fill in any missing account fields so older session JSON still loads with the current shape.
export function normalizeAccountState(account: Partial<AccountState>): AccountState {
    return {
        date: account.date ?? DEFAULT_ACCOUNT_DATE,
        cash: account.cash ?? 0,
        positions: account.positions ?? {},
    }
}

// Read the shared default user account and create the default file if it is missing.
export async function readDefaultUserAccountSession({
    cwd = process.cwd,
    makeDirectory = fs.mkdir,
    readFile = fs.readFile,
    writeFile = fs.writeFile,
}: AccountSessionDependencies = {}): Promise<AccountState> {
    const sessionFilePath = path.join(cwd(), DEFAULT_USER_SESSION_RELATIVE_PATH)

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
    const sessionFilePath = path.join(cwd(), DEFAULT_USER_SESSION_RELATIVE_PATH)

    await makeDirectory(path.dirname(sessionFilePath), { recursive: true })
    await writeFile(sessionFilePath, `${JSON.stringify(account, null, 2)}\n`, 'utf8')

    return account
}
