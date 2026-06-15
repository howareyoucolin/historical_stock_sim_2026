import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
    DEFAULT_USER_SESSION_RELATIVE_PATH,
    getDefaultUserSessionFilePath,
    initializeDefaultUserAccountSession,
    readDefaultUserAccountSession,
} from './session-store'

// Build a temporary repo root so file-backed account session tests can run in isolation.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify the default user session path always points at the shared JSON file.
function testGetDefaultUserSessionFilePath(): void {
    assert.equal(getDefaultUserSessionFilePath(() => '/repo'), '/repo/user-sessions/default.json')
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

    assert.deepEqual(account, { cash: 0, positions: {} })
    assert.deepEqual(savedAccount, { cash: 0, positions: {} })
}

// Verify account init replaces any previous account data with the default account object.
async function testInitializeDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const sessionFilePath = path.join(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH)

    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true })
    await fs.writeFile(
        sessionFilePath,
        `${JSON.stringify(
            {
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
            },
            null,
            2
        )}\n`,
        'utf8'
    )

    const account = await initializeDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
    })
    const savedAccount = JSON.parse(await fs.readFile(sessionFilePath, 'utf8')) as {
        cash: number
        positions: Record<string, unknown>
    }

    assert.deepEqual(account, { cash: 0, positions: {} })
    assert.deepEqual(savedAccount, { cash: 0, positions: {} })
}

// Run the focused tests that protect the shared user session file behavior.
export async function runUserSessionStoreTests(): Promise<void> {
    testGetDefaultUserSessionFilePath()
    await testReadDefaultUserAccountSession()
    await testInitializeDefaultUserAccountSession()
    console.log('User session store tests passed.')
}
