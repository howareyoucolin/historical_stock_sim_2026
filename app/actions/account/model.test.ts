import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
    createDefaultAccountState,
    DEFAULT_USER_SESSION_META_RELATIVE_PATH,
    DEFAULT_USER_SESSION_RELATIVE_PATH,
    readDefaultUserAccountSession,
    writeDefaultUserAccountSession,
} from './model'

const DEFAULT_ACCOUNT_STATE = createDefaultAccountState()

// A fixed clock so the persisted `updated_at` timestamp is deterministic in assertions.
const FIXED_NOW = new Date('2020-01-02T03:04:05.000Z')

// Build a temporary repo root so file-backed account session tests can run in isolation.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Read and parse one session file relative to the temp repo root.
async function readSessionFile(tempRepoRoot: string, relativePath: string): Promise<Record<string, unknown>> {
    return JSON.parse(await fs.readFile(path.join(tempRepoRoot, relativePath), 'utf8')) as Record<string, unknown>
}

// Verify the default user session paths point at the account data file and the metadata file.
function testGetDefaultUserSessionFilePath(): void {
    assert.equal(path.join('/repo', DEFAULT_USER_SESSION_RELATIVE_PATH), '/repo/user-sessions/default/account.json')
    assert.equal(path.join('/repo', DEFAULT_USER_SESSION_META_RELATIVE_PATH), '/repo/user-sessions/default/meta.json')
}

// Verify reading the shared session creates the split data and metadata files when both are missing.
async function testReadDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const account = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot, now: () => FIXED_NOW })

    assert.deepEqual(account, DEFAULT_ACCOUNT_STATE)
    assert.deepEqual(await readSessionFile(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH), {
        cash: 0,
        positions: {},
    })
    assert.deepEqual(await readSessionFile(tempRepoRoot, DEFAULT_USER_SESSION_META_RELATIVE_PATH), {
        date: DEFAULT_ACCOUNT_STATE.date,
        updated_at: FIXED_NOW.toISOString(),
    })
}

// Verify a data file without a metadata file still loads, defaulting the simulated date.
async function testReadDefaultUserAccountSessionMissingMeta(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const dataFilePath = path.join(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH)

    await fs.mkdir(path.dirname(dataFilePath), { recursive: true })
    await fs.writeFile(dataFilePath, JSON.stringify({ cash: 1200, positions: {} }), 'utf8')

    const account = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    assert.deepEqual(account, { ...DEFAULT_ACCOUNT_STATE, cash: 1200 })
}

// Verify a pre-split single account file is migrated into the data and metadata files on first read.
async function testReadDefaultUserAccountSessionMigratesLegacyFile(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const legacyFilePath = path.join(tempRepoRoot, 'user-sessions', 'default.json')
    const legacyAccount = { date: '2018-03-10', cash: 999, positions: {} }

    await fs.mkdir(path.dirname(legacyFilePath), { recursive: true })
    await fs.writeFile(legacyFilePath, JSON.stringify(legacyAccount), 'utf8')

    const account = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot, now: () => FIXED_NOW })

    assert.deepEqual(account, legacyAccount)
    assert.deepEqual(await readSessionFile(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH), { cash: 999, positions: {} })
    assert.equal((await readSessionFile(tempRepoRoot, DEFAULT_USER_SESSION_META_RELATIVE_PATH)).date, '2018-03-10')
}

// Verify malformed session JSON fails loudly instead of being silently replaced.
async function testReadDefaultUserAccountSessionInvalidJson(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const dataFilePath = path.join(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH)

    await fs.mkdir(path.dirname(dataFilePath), { recursive: true })
    await fs.writeFile(dataFilePath, '{not-valid-json', 'utf8')

    await assert.rejects(() => readDefaultUserAccountSession({ cwd: () => tempRepoRoot }), /Invalid account session JSON/)
}

// Verify the shared write helper splits the account across the data and metadata files and stamps updated_at.
async function testWriteDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const accountToPersist = {
        date: '2018-03-10',
        cash: 1200,
        positions: {
            AAPL: [{ quantity: 3, cost_per_share: 200, purchase_date: '2026-06-15' }],
        },
    }

    const account = await writeDefaultUserAccountSession(accountToPersist, { cwd: () => tempRepoRoot, now: () => FIXED_NOW })

    assert.deepEqual(account, accountToPersist)
    assert.deepEqual(await readSessionFile(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH), {
        cash: 1200,
        positions: accountToPersist.positions,
    })
    assert.deepEqual(await readSessionFile(tempRepoRoot, DEFAULT_USER_SESSION_META_RELATIVE_PATH), {
        date: '2018-03-10',
        updated_at: FIXED_NOW.toISOString(),
    })
}

// Run the focused tests that protect the shared user session file behavior.
export async function runUserSessionStoreTests(): Promise<void> {
    testGetDefaultUserSessionFilePath()
    await testReadDefaultUserAccountSession()
    await testReadDefaultUserAccountSessionMissingMeta()
    await testReadDefaultUserAccountSessionMigratesLegacyFile()
    await testReadDefaultUserAccountSessionInvalidJson()
    await testWriteDefaultUserAccountSession()
}
