import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { depositIntoDefaultUserAccountSession } from './deposit'
import { readDefaultUserAccountSession, writeDefaultUserAccountSession } from './model'
import { readHistoryLogEntries } from '../history/log'

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

    const account = await depositIntoDefaultUserAccountSession(-250, {
        cwd: () => tempRepoRoot,
    })
    const savedAccount = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    assert.equal(account.date, '2018-03-10')
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
    assert.equal(savedAccount.date, '2018-03-10')
    assert.equal(savedAccount.cash, 950)
}

// Verify an optional note is recorded on the DEPOSIT history row so contributions can be annotated.
async function testDepositIntoDefaultUserAccountSessionRecordsNote(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        { date: '2018-03-10', cash: 0, positions: {} },
        { cwd: () => tempRepoRoot }
    )

    await depositIntoDefaultUserAccountSession(2500, { cwd: () => tempRepoRoot }, 'Monthly recurring contribution')

    const entries = await readHistoryLogEntries({ cwd: () => tempRepoRoot })

    assert.equal(entries.length, 1)
    assert.match(entries[0], /DEPOSIT/)
    assert.match(entries[0], /note="Monthly recurring contribution"/)
}

// Run the focused deposit action tests that protect cash mutations on the shared account file.
export async function runDepositAccountActionTests(): Promise<void> {
    await testDepositIntoDefaultUserAccountSessionInvalidCash()
    await testDepositIntoDefaultUserAccountSession()
    await testDepositIntoDefaultUserAccountSessionRecordsNote()
}
