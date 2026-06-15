import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { depositIntoDefaultUserAccountSession } from './deposit'
import { DEFAULT_USER_SESSION_RELATIVE_PATH, writeDefaultUserAccountSession } from './model'

// Build a temporary repo root so deposit action tests can mutate an isolated session file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify deposits reject invalid cash deltas before touching the shared session file.
async function testDepositIntoDefaultUserAccountSessionInvalidCash(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await assert.rejects(
        () =>
            depositIntoDefaultUserAccountSession(Number.NaN, {
                cwd: () => tempRepoRoot,
            }),
        /finite number/
    )

    await assert.rejects(
        () =>
            depositIntoDefaultUserAccountSession(Number.POSITIVE_INFINITY, {
                cwd: () => tempRepoRoot,
            }),
        /finite number/
    )
}

// Verify deposits update cash while preserving the rest of the shared account object.
async function testDepositIntoDefaultUserAccountSession(): Promise<void> {
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

    const account = await depositIntoDefaultUserAccountSession(-250, {
        cwd: () => tempRepoRoot,
    })
    const savedAccount = JSON.parse(await fs.readFile(sessionFilePath, 'utf8')) as {
        cash: number
        positions: Record<string, unknown>
    }

    assert.equal(account.cash, 950)
    assert.deepEqual(account.positions, {
        AAPL: [
            {
                quantity: 3,
                cost_per_share: 200,
                purchase_date: '2026-06-15',
            },
        ],
    })
    assert.equal(savedAccount.cash, 950)
}

// Run the focused deposit action tests that protect cash mutations on the shared account file.
export async function runDepositAccountActionTests(): Promise<void> {
    await testDepositIntoDefaultUserAccountSessionInvalidCash()
    await testDepositIntoDefaultUserAccountSession()
}
