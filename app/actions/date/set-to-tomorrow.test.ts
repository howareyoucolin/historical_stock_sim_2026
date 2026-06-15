import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_USER_SESSION_RELATIVE_PATH, writeDefaultUserAccountSession } from '../account/model'
import { setDefaultUserAccountDateToTomorrow } from './set-to-tomorrow'

// Build a temporary repo root so date-next action tests can mutate an isolated session file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify advancing to tomorrow moves the simulation date forward and preserves the rest of the session.
async function testSetDefaultUserAccountDateToTomorrow(): Promise<void> {
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
                        purchase_date: '2018-03-01',
                    },
                ],
            },
        },
        {
            cwd: () => tempRepoRoot,
        }
    )

    const account = await setDefaultUserAccountDateToTomorrow({
        cwd: () => tempRepoRoot,
    })
    const savedAccount = JSON.parse(await fs.readFile(sessionFilePath, 'utf8')) as {
        date: string
        cash: number
        positions: Record<string, unknown>
    }

    assert.equal(account.date, '2018-03-11')
    assert.equal(account.cash, 1200)
    assert.deepEqual(account.positions, {
        AAPL: [
            {
                quantity: 3,
                cost_per_share: 200,
                purchase_date: '2018-03-01',
            },
        ],
    })
    assert.deepEqual(savedAccount, account)
}

// Verify advancing to tomorrow also works when the default session file does not exist yet.
async function testSetDefaultUserAccountDateToTomorrowCreatesDefaultSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    const account = await setDefaultUserAccountDateToTomorrow({
        cwd: () => tempRepoRoot,
    })

    assert.equal(account.date, '2016-01-05')
    assert.equal(account.cash, 0)
    assert.deepEqual(account.positions, {})
}

// Run the focused date-next action tests that protect simulation date advancement behavior.
export async function runSetDateToTomorrowActionTests(): Promise<void> {
    await testSetDefaultUserAccountDateToTomorrow()
    await testSetDefaultUserAccountDateToTomorrowCreatesDefaultSession()
}
