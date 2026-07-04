import fs from 'node:fs/promises'
import path from 'node:path'

import { createDefaultAccountState, DEFAULT_ACCOUNT_DATE, normalizeAccountState, type AccountData, type AccountMeta, type AccountState } from './state'
import {
    accountDataFileName,
    accountMetaFileName,
    DEFAULT_SESSION_NAME,
    legacyAccountSessionFileName,
    legacyFlatAccountDataFileName,
    legacyFlatAccountMetaFileName,
    USER_SESSIONS_DIRECTORY_NAME,
} from '../session'

export { createDefaultAccountState, DEFAULT_ACCOUNT_DATE, normalizeAccountState, type AccountData, type AccountMeta, type AccountPosition, type AccountState } from './state'

export { USER_SESSIONS_DIRECTORY_NAME } from '../session'

// The account state is persisted across two files inside each session folder: account.json (cash +
// positions) and meta.json (sim date + updated_at). Paths below are session-aware, resolved per call.
export const DEFAULT_USER_SESSION_FILE_NAME = 'account.json'
export const DEFAULT_USER_SESSION_RELATIVE_PATH = `${USER_SESSIONS_DIRECTORY_NAME}/${DEFAULT_SESSION_NAME}/${DEFAULT_USER_SESSION_FILE_NAME}`
export const DEFAULT_USER_SESSION_META_FILE_NAME = 'meta.json'
export const DEFAULT_USER_SESSION_META_RELATIVE_PATH = `${USER_SESSIONS_DIRECTORY_NAME}/${DEFAULT_SESSION_NAME}/${DEFAULT_USER_SESSION_META_FILE_NAME}`

// Repo-relative paths of the active session's data/metadata (current folder layout).
function accountDataRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${accountDataFileName()}`
}

function accountMetaRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${accountMetaFileName()}`
}

// Legacy pre-folder paths, only consulted to migrate an existing session into its folder on read.
function legacyFlatAccountDataRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${legacyFlatAccountDataFileName()}`
}

function legacyFlatAccountMetaRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${legacyFlatAccountMetaFileName()}`
}

function legacyAccountRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${legacyAccountSessionFileName()}`
}

export interface AccountSessionDependencies {
    cwd?: () => string
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
    writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
    now?: () => Date
}

// Parse a JSON session file, returning null when it does not exist yet so callers can distinguish a
// missing file from a malformed one (which still surfaces loudly).
async function readJsonSessionFile<T>(filePath: string, readFile: NonNullable<AccountSessionDependencies['readFile']>): Promise<T | null> {
    try {
        return JSON.parse(await readFile(filePath, 'utf8')) as T
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null
        }

        if (error instanceof SyntaxError) {
            throw new Error(`Invalid account session JSON: ${error.message}`)
        }

        throw error
    }
}

// Read the shared default user account by merging the data and metadata files. When neither exists,
// a pre-split single file is migrated if present, otherwise the default account is seeded on disk.
export async function readDefaultUserAccountSession({
    cwd = process.cwd,
    makeDirectory = fs.mkdir,
    readFile = fs.readFile,
    writeFile = fs.writeFile,
    now = () => new Date(),
}: AccountSessionDependencies = {}): Promise<AccountState> {
    const data = await readJsonSessionFile<Partial<AccountData>>(path.join(cwd(), accountDataRelativePath()), readFile)
    const meta = await readJsonSessionFile<Partial<AccountMeta>>(path.join(cwd(), accountMetaRelativePath()), readFile)

    if (data !== null || meta !== null) {
        return normalizeAccountState({ date: meta?.date, cash: data?.cash, positions: data?.positions, accruedInterest: data?.accruedInterest })
    }

    // Migrate an older on-disk layout into the session folder: first the flat split files
    // (bare / <name>.account.json + .meta.json), then the oldest pre-split single file.
    const flatData = await readJsonSessionFile<Partial<AccountData>>(path.join(cwd(), legacyFlatAccountDataRelativePath()), readFile)
    const flatMeta = await readJsonSessionFile<Partial<AccountMeta>>(path.join(cwd(), legacyFlatAccountMetaRelativePath()), readFile)

    if (flatData !== null || flatMeta !== null) {
        const migrated = normalizeAccountState({ date: flatMeta?.date, cash: flatData?.cash, positions: flatData?.positions, accruedInterest: flatData?.accruedInterest })

        return writeDefaultUserAccountSession(migrated, { cwd, makeDirectory, writeFile, now })
    }

    const legacyAccount = await readJsonSessionFile<Partial<AccountState>>(path.join(cwd(), legacyAccountRelativePath()), readFile)
    const account = legacyAccount !== null ? normalizeAccountState(legacyAccount) : createDefaultAccountState()

    return writeDefaultUserAccountSession(account, { cwd, makeDirectory, writeFile, now })
}

// Read just the lightweight session metadata (sim date + updated_at) without building the full
// account view, so a freshness probe can check `updated_at` cheaply. Returns null before first write.
export async function readDefaultUserAccountMeta({
    cwd = process.cwd,
    readFile = fs.readFile,
}: AccountSessionDependencies = {}): Promise<AccountMeta | null> {
    return readJsonSessionFile<AccountMeta>(path.join(cwd(), accountMetaRelativePath()), readFile)
}

// Write the shared default user account, splitting it into the data and metadata files and stamping
// `updated_at` on every write so pollers can detect changes by comparing that timestamp.
export async function writeDefaultUserAccountSession(
    account: AccountState,
    {
        cwd = process.cwd,
        makeDirectory = fs.mkdir,
        writeFile = fs.writeFile,
        now = () => new Date(),
    }: AccountSessionDependencies = {}
): Promise<AccountState> {
    const sessionDirectory = path.join(cwd(), USER_SESSIONS_DIRECTORY_NAME)

    // Create the per-session folder (dirname of the data file), e.g. user-sessions/<name>/.
    await makeDirectory(path.dirname(path.join(sessionDirectory, accountDataFileName())), { recursive: true })

    const data: AccountData = { cash: account.cash, positions: account.positions }

    // Persist accrued interest only when it is non-zero so a fresh or fully-deployed account keeps
    // the minimal { cash, positions } file shape.
    if (account.accruedInterest) {
        data.accruedInterest = account.accruedInterest
    }

    const meta: AccountMeta = { date: account.date, updated_at: now().toISOString() }

    await writeFile(path.join(sessionDirectory, accountDataFileName()), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    await writeFile(path.join(sessionDirectory, accountMetaFileName()), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

    return account
}
