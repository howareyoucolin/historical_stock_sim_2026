import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
    DEFAULT_USER_SESSION_RELATIVE_PATH,
    readDefaultUserAccountSession,
    writeDefaultUserAccountSession,
} from './model'

const DEFAULT_ACCOUNT_STATE = {
    cash: 0,
    positions: {},
}

// Build a temporary repo root so file-backed account session tests can run in isolation.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify the default user session path always points at the shared JSON file.
function testGetDefaultUserSessionFilePath(): void {
    assert.equal(path.join('/repo', DEFAULT_USER_SESSION_RELATIVE_PATH), '/repo/user-sessions/default.json')
}

// Verify reading the shared session creates the default file when it is missing.
async function testReadDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const account = await readDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
    })
    const savedAccount = JSON.parse(await fs.readFile(path.join(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH), 'utf8')) as {
        cash: number
        positions: Record<string, unknown>
    }

    assert.deepEqual(account, DEFAULT_ACCOUNT_STATE)
    assert.deepEqual(savedAccount, DEFAULT_ACCOUNT_STATE)
}

// Verify malformed session JSON fails loudly instead of being silently replaced.
async function testReadDefaultUserAccountSessionInvalidJson(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const sessionFilePath = path.join(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH)

    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true })
    await fs.writeFile(sessionFilePath, '{not-valid-json', 'utf8')

    await assert.rejects(
        () =>
            readDefaultUserAccountSession({
                cwd: () => tempRepoRoot,
            }),
        /Invalid account session JSON/
    )
}

// Verify the shared write helper persists the provided account object into the default session file.
async function testWriteDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const sessionFilePath = path.join(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH)
    const accountToPersist = {
        cash: 1200,
        positions: {
            AAPL: [
                {
                    quantity: 3,
                    cost_per_share: 200,
                    purchase_date: '2026-06-15',
                },
            ],
        },
    }

    const account = await writeDefaultUserAccountSession(accountToPersist, {
        cwd: () => tempRepoRoot,
    })
    const savedAccount = JSON.parse(await fs.readFile(sessionFilePath, 'utf8')) as {
        cash: number
        positions: Record<string, unknown>
    }

    assert.deepEqual(account, accountToPersist)
    assert.deepEqual(savedAccount, accountToPersist)
}

// Run the focused tests that protect the shared user session file behavior.
export async function runUserSessionStoreTests(): Promise<void> {
    testGetDefaultUserSessionFilePath()
    await testReadDefaultUserAccountSession()
    await testReadDefaultUserAccountSessionInvalidJson()
    await testWriteDefaultUserAccountSession()
}
