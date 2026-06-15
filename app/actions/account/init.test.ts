import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { initializeDefaultUserAccountSession } from './init'
import { DEFAULT_USER_SESSION_RELATIVE_PATH, writeDefaultUserAccountSession } from './model'

const DEFAULT_ACCOUNT_STATE = {
    cash: 0,
    positions: {},
}

// Build a temporary repo root so init action tests can mutate an isolated session file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify account init replaces any previous account data with the default account object.
async function testInitializeDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const sessionFilePath = path.join(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH)

    await writeDefaultUserAccountSession(
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
        {
            cwd: () => tempRepoRoot,
        }
    )

    const account = await initializeDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
    })
    const savedAccount = JSON.parse(await fs.readFile(sessionFilePath, 'utf8')) as {
        cash: number
        positions: Record<string, unknown>
    }

    assert.deepEqual(account, DEFAULT_ACCOUNT_STATE)
    assert.deepEqual(savedAccount, DEFAULT_ACCOUNT_STATE)
}

// Run the focused init action tests that protect the account reset flow.
export async function runInitializeAccountActionTests(): Promise<void> {
    await testInitializeDefaultUserAccountSession()
    console.log('Account init action tests passed.')
}
