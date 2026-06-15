import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_USER_SESSION_RELATIVE_PATH, writeDefaultUserAccountSession } from '../account/model'
import { setDefaultUserAccountDateToSpecificDate } from './set-to-specific-date'

// Build a temporary repo root so date-set action tests can mutate an isolated session file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify setting a specific date updates the simulation date and preserves the rest of the session.
async function testSetDefaultUserAccountDateToSpecificDate(): Promise<void> {
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

    const account = await setDefaultUserAccountDateToSpecificDate('2018-04-02', {
        cwd: () => tempRepoRoot,
    })
    const savedAccount = JSON.parse(await fs.readFile(sessionFilePath, 'utf8')) as {
        date: string
        cash: number
        positions: Record<string, unknown>
    }

    assert.equal(account.date, '2018-04-02')
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

// Verify invalid specific dates fail before the shared session is rewritten.
async function testSetDefaultUserAccountDateToSpecificDateInvalidDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await assert.rejects(
        () =>
            setDefaultUserAccountDateToSpecificDate('2018-02-30', {
                cwd: () => tempRepoRoot,
            }),
        /Date must be a valid YYYY-MM-DD value/
    )
}

// Verify setting a past date is rejected so the simulation timeline only moves forward.
async function testSetDefaultUserAccountDateToSpecificDateBackwardDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2018-03-10',
            cash: 1200,
            positions: {},
        },
        {
            cwd: () => tempRepoRoot,
        }
    )

    await assert.rejects(
        () =>
            setDefaultUserAccountDateToSpecificDate('2018-03-09', {
                cwd: () => tempRepoRoot,
            }),
        /Simulation date cannot move backward from 2018-03-10/
    )
}

// Verify setting the current date again is allowed as a no-op instead of being treated as backward.
async function testSetDefaultUserAccountDateToSpecificDateSameDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2018-03-10',
            cash: 1200,
            positions: {},
        },
        {
            cwd: () => tempRepoRoot,
        }
    )

    const account = await setDefaultUserAccountDateToSpecificDate('2018-03-10', {
        cwd: () => tempRepoRoot,
    })

    assert.equal(account.date, '2018-03-10')
    assert.equal(account.cash, 1200)
    assert.deepEqual(account.positions, {})
}

// Run the focused date-set action tests that protect direct simulation date updates.
export async function runSetDateToSpecificDateActionTests(): Promise<void> {
    await testSetDefaultUserAccountDateToSpecificDate()
    await testSetDefaultUserAccountDateToSpecificDateInvalidDate()
    await testSetDefaultUserAccountDateToSpecificDateBackwardDate()
    await testSetDefaultUserAccountDateToSpecificDateSameDate()
}
