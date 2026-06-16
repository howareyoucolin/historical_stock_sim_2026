import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { initializeDefaultUserAccountSession } from './init'
import { appendHistoryEvent, HISTORY_LOG_RELATIVE_PATH } from '../history/log'
import { createDefaultAccountState, DEFAULT_USER_SESSION_RELATIVE_PATH, writeDefaultUserAccountSession } from './model'

const DEFAULT_ACCOUNT_STATE = createDefaultAccountState()

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
            date: '2018-03-10',
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
        date: string
        cash: number
        positions: Record<string, unknown>
    }

    assert.deepEqual(account, DEFAULT_ACCOUNT_STATE)
    assert.deepEqual(savedAccount, DEFAULT_ACCOUNT_STATE)
}

// Verify account init wipes the history log so the audit trail matches the reset account.
async function testInitializeDefaultUserAccountSessionClearsHistory(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const logFilePath = path.join(tempRepoRoot, HISTORY_LOG_RELATIVE_PATH)

    await appendHistoryEvent(
        { type: 'DEPOSIT', simDate: '2016-01-04', cashDelta: 1000 },
        { cwd: () => tempRepoRoot }
    )

    await initializeDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    await assert.rejects(() => fs.readFile(logFilePath, 'utf8'), /ENOENT/)
}

// Run the focused init action tests that protect the account reset flow.
export async function runInitializeAccountActionTests(): Promise<void> {
    await testInitializeDefaultUserAccountSession()
    await testInitializeDefaultUserAccountSessionClearsHistory()
}
