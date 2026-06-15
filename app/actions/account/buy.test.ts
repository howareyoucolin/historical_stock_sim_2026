import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, END_DATE, HISTORY_FILE_NAME, START_DATE } from '../stock/download-data'
import { buyStockInDefaultUserAccountSession } from './buy'
import { DEFAULT_ACCOUNT_DATE, DEFAULT_USER_SESSION_RELATIVE_PATH, writeDefaultUserAccountSession } from './model'

// Build a temporary repo root so buy action tests can mutate isolated account and market data files.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Write a local stock history file that mirrors the saved market-data structure used by the buy action.
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
        `${JSON.stringify({ stockCode, source: 'Yahoo Finance', range: { start: START_DATE, end: END_DATE }, historyByDate }, null, 2)}\n`,
        'utf8'
    )
}

// Verify buy rejects invalid share quantities before mutating the shared account session.
async function testBuyStockInDefaultUserAccountSessionInvalidQuantity(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await assert.rejects(
        () =>
            buyStockInDefaultUserAccountSession('AAPL', 0, {
                cwd: () => tempRepoRoot,
            }),
        /positive integer/
    )

    await assert.rejects(
        () =>
            buyStockInDefaultUserAccountSession('AAPL', 1.5, {
                cwd: () => tempRepoRoot,
            }),
        /positive integer/
    )
}

// Verify buy uses the account date to price the purchase and appends the new lot to the account.
async function testBuyStockInDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const sessionFilePath = path.join(tempRepoRoot, DEFAULT_USER_SESSION_RELATIVE_PATH)

    await writeDefaultUserAccountSession(
        {
            date: DEFAULT_ACCOUNT_DATE,
            cash: 1000,
            positions: {
                MSFT: [
                    {
                        quantity: 1,
                        cost_per_share: 50,
                        purchase_date: '2015-12-31',
                    },
                ],
            },
        },
        {
            cwd: () => tempRepoRoot,
        }
    )
    await writeLocalStockHistory(tempRepoRoot, 'AAPL', {
        [DEFAULT_ACCOUNT_DATE]: {
            close: 10.5,
            isPayoutDate: false,
            dividendPerShare: 0,
        },
        '2016-01-05': {
            close: 12,
            isPayoutDate: false,
            dividendPerShare: 0,
        },
    })

    const result = await buyStockInDefaultUserAccountSession('aapl', 3, {
        cwd: () => tempRepoRoot,
    })
    const savedAccount = JSON.parse(await fs.readFile(sessionFilePath, 'utf8')) as {
        date: string
        cash: number
        positions: Record<string, unknown>
    }

    assert.equal(result.stockCode, 'AAPL')
    assert.equal(result.quantity, 3)
    assert.equal(result.costPerShare, 10.5)
    assert.equal(result.totalCost, 31.5)
    assert.equal(result.account.cash, 968.5)
    assert.deepEqual(result.account.positions.AAPL, [
        {
            quantity: 3,
            cost_per_share: 10.5,
            purchase_date: DEFAULT_ACCOUNT_DATE,
        },
    ])
    assert.deepEqual(result.account.positions.MSFT, [
        {
            quantity: 1,
            cost_per_share: 50,
            purchase_date: '2015-12-31',
        },
    ])
    assert.deepEqual(savedAccount, result.account)
}

// Verify buy fails when the downloaded local history does not include the account's current simulation date.
async function testBuyStockInDefaultUserAccountSessionMissingPriceDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: DEFAULT_ACCOUNT_DATE,
            cash: 1000,
            positions: {},
        },
        {
            cwd: () => tempRepoRoot,
        }
    )
    await writeLocalStockHistory(tempRepoRoot, 'AAPL', {
        '2016-01-05': {
            close: 12,
            isPayoutDate: false,
            dividendPerShare: 0,
        },
    })

    await assert.rejects(
        () =>
            buyStockInDefaultUserAccountSession('AAPL', 1, {
                cwd: () => tempRepoRoot,
            }),
        /No price data found for AAPL on 2016-01-04/
    )
}

// Verify buy rejects purchases that cost more cash than the account currently has available.
async function testBuyStockInDefaultUserAccountSessionInsufficientCash(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: DEFAULT_ACCOUNT_DATE,
            cash: 5,
            positions: {},
        },
        {
            cwd: () => tempRepoRoot,
        }
    )
    await writeLocalStockHistory(tempRepoRoot, 'AAPL', {
        [DEFAULT_ACCOUNT_DATE]: {
            close: 10.5,
            isPayoutDate: false,
            dividendPerShare: 0,
        },
    })

    await assert.rejects(
        () =>
            buyStockInDefaultUserAccountSession('AAPL', 1, {
                cwd: () => tempRepoRoot,
            }),
        /Not enough cash/
    )
}

// Run the focused buy action tests that protect date-based pricing and account mutations.
export async function runBuyAccountActionTests(): Promise<void> {
    await testBuyStockInDefaultUserAccountSessionInvalidQuantity()
    await testBuyStockInDefaultUserAccountSession()
    await testBuyStockInDefaultUserAccountSessionMissingPriceDate()
    await testBuyStockInDefaultUserAccountSessionInsufficientCash()
}
