import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME } from '../stock/download-data'
import { createDefaultAccountState, DEFAULT_USER_SESSION_RELATIVE_PATH, writeDefaultUserAccountSession } from './model'
import { fetchDefaultUserAccountSession, showDefaultUserAccountSession } from './show'

const DEFAULT_ACCOUNT_STATE = createDefaultAccountState()

// Build a temporary repo root so show action tests can read an isolated session file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Write a local stock history file that mirrors the saved market-data structure used by account actions.
async function writeLocalStockHistory(
    tempRepoRoot: string,
    stockCode: string,
    historyByDate: Record<string, { close: number | null; isPayoutDate: boolean; dividendPerShare: number }>
): Promise<void> {
    const outputDirectory = path.join(tempRepoRoot, DATA_DIRECTORY_NAME, stockCode)
    const outputPath = path.join(outputDirectory, HISTORY_FILE_NAME)

    await fs.mkdir(outputDirectory, { recursive: true })
    await fs.writeFile(
        outputPath,
        `${JSON.stringify({ stockCode, source: 'Yahoo Finance', range: { start: '2016-01-01', end: '2026-01-01' }, historyByDate }, null, 2)}\n`,
        'utf8'
    )
}

// Verify the fetch action returns the existing shared session JSON without changing its contents.
async function testFetchDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const accountToPersist = {
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
    }

    await writeDefaultUserAccountSession(accountToPersist, {
        cwd: () => tempRepoRoot,
    })

    const account = await fetchDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
    })

    assert.deepEqual(account, accountToPersist)
}

// Verify the fetch action creates and returns the default shared session when the file is missing.
async function testFetchDefaultUserAccountSessionCreatesDefaultFile(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const sessionFilePath = path.join(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH)

    const account = await fetchDefaultUserAccountSession({
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

// Verify the show action renders a per-stock holdings table using the account date as the current price date.
async function testShowDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2018-03-10',
            cash: 1200,
            positions: {
                MSFT: [
                    {
                        quantity: 4,
                        cost_per_share: 50,
                        purchase_date: '2018-03-10',
                    },
                ],
                AAPL: [
                    {
                        quantity: 2,
                        cost_per_share: 100,
                        purchase_date: '2018-03-01',
                    },
                    {
                        quantity: 1,
                        cost_per_share: 130,
                        purchase_date: '2018-03-05',
                    },
                ],
            },
        },
        {
            cwd: () => tempRepoRoot,
        }
    )
    await writeLocalStockHistory(tempRepoRoot, 'AAPL', {
        '2018-03-10': {
            close: 150,
            isPayoutDate: false,
            dividendPerShare: 0,
        },
    })
    await writeLocalStockHistory(tempRepoRoot, 'MSFT', {
        '2018-03-10': {
            close: 40,
            isPayoutDate: false,
            dividendPerShare: 0,
        },
    })

    const output = await showDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
    })

    assert.equal(
        output,
        [
            'Date: 2018-03-10',
            'Cash: 1200.00',
            'Basis: 530.00 | Value: 610.00 | P/L: 80.00 | P/L%: 15.09%',
            '',
            'stock_code | average_cost | current_price | quantity | total_value | total_gain_loss | percent_gain_loss',
            '-----------+--------------+---------------+----------+-------------+-----------------+------------------',
            'AAPL       |       110.00 |        150.00 |        3 |      450.00 |          120.00 |            36.36%',
            'MSFT       |        50.00 |         40.00 |        4 |      160.00 |          -40.00 |           -20.00%',
        ].join('\n')
    )
}

// Verify the show action reports an empty holdings state without trying to render a stock table.
async function testShowDefaultUserAccountSessionWithoutTrackedStocks(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    const output = await showDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
    })

    assert.equal(
        output,
        [
            `Date: ${DEFAULT_ACCOUNT_STATE.date}`,
            'Cash: 0.00',
            'Basis: 0.00 | Value: 0.00 | P/L: 0.00 | P/L%: 0.00%',
            '',
            `No tracked stocks found in ${DEFAULT_USER_SESSION_RELATIVE_PATH}.`,
        ].join('\n')
    )
}

// Run the focused show action tests that protect fetching and rendering the shared account session.
export async function runShowAccountActionTests(): Promise<void> {
    await testFetchDefaultUserAccountSession()
    await testFetchDefaultUserAccountSessionCreatesDefaultFile()
    await testShowDefaultUserAccountSession()
    await testShowDefaultUserAccountSessionWithoutTrackedStocks()
}
