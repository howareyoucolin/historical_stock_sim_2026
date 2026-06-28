import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { stockDataFetcher } from '../../test-helpers/market-data'
import { sellStockInDefaultUserAccountSession } from './sell'
import { HISTORY_LOG_RELATIVE_PATH } from '../history/log'
import { DEFAULT_ACCOUNT_DATE, readDefaultUserAccountSession, writeDefaultUserAccountSession } from './model'

// Build a temporary repo root so sell action tests can mutate isolated account files.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify sell rejects invalid share quantities before mutating the shared account session.
async function testSellStockInDefaultUserAccountSessionInvalidQuantity(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await assert.rejects(() => sellStockInDefaultUserAccountSession('AAPL', 0, { cwd: () => tempRepoRoot }), /positive integer/)
    await assert.rejects(() => sellStockInDefaultUserAccountSession('AAPL', 1.5, { cwd: () => tempRepoRoot }), /positive integer/)
}

// Verify sell prices at the account date, reduces lots oldest-first, and credits the proceeds to cash.
async function testSellStockInDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: DEFAULT_ACCOUNT_DATE,
            cash: 100,
            positions: {
                AAPL: [
                    { quantity: 3, cost_per_share: 10, purchase_date: '2015-12-31' },
                    { quantity: 2, cost_per_share: 20, purchase_date: DEFAULT_ACCOUNT_DATE },
                ],
                MSFT: [{ quantity: 1, cost_per_share: 50, purchase_date: '2015-12-31' }],
            },
        },
        { cwd: () => tempRepoRoot }
    )

    const result = await sellStockInDefaultUserAccountSession('aapl', 4, {
        cwd: () => tempRepoRoot,
        getStockData: stockDataFetcher({
            AAPL: { [DEFAULT_ACCOUNT_DATE]: { close: 15 } },
        }),
    })
    const savedAccount = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    assert.equal(result.stockCode, 'AAPL')
    assert.equal(result.quantity, 4)
    assert.equal(result.pricePerShare, 15)
    assert.equal(result.totalProceeds, 60)
    assert.equal(result.account.cash, 160)
    // FIFO: the older 3-share lot is fully sold, leaving 1 share from the newer lot.
    assert.deepEqual(result.account.positions.AAPL, [{ quantity: 1, cost_per_share: 20, purchase_date: DEFAULT_ACCOUNT_DATE }])
    assert.deepEqual(result.account.positions.MSFT, [{ quantity: 1, cost_per_share: 50, purchase_date: '2015-12-31' }])
    assert.deepEqual(savedAccount, result.account)
}

// Verify selling the entire holding removes the stock from the account positions.
async function testSellStockInDefaultUserAccountSessionRemovesEmptyHolding(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: DEFAULT_ACCOUNT_DATE,
            cash: 0,
            positions: {
                AAPL: [{ quantity: 5, cost_per_share: 10, purchase_date: '2015-12-31' }],
            },
        },
        { cwd: () => tempRepoRoot }
    )

    const result = await sellStockInDefaultUserAccountSession('AAPL', 5, {
        cwd: () => tempRepoRoot,
        getStockData: stockDataFetcher({
            AAPL: { [DEFAULT_ACCOUNT_DATE]: { close: 12 } },
        }),
    })

    assert.equal(result.account.cash, 60)
    assert.equal('AAPL' in result.account.positions, false)
}

// Verify sell rejects selling more shares than the account owns before reading market data.
async function testSellStockInDefaultUserAccountSessionInsufficientShares(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: DEFAULT_ACCOUNT_DATE,
            cash: 0,
            positions: {
                AAPL: [{ quantity: 2, cost_per_share: 10, purchase_date: '2015-12-31' }],
            },
        },
        { cwd: () => tempRepoRoot }
    )

    await assert.rejects(() => sellStockInDefaultUserAccountSession('AAPL', 5, { cwd: () => tempRepoRoot }), /Not enough shares of AAPL/)
    // A stock the account does not hold at all is also rejected.
    await assert.rejects(() => sellStockInDefaultUserAccountSession('MSFT', 1, { cwd: () => tempRepoRoot }), /Not enough shares of MSFT/)
}

// Verify sell fails when the fetched market data does not include the account's current simulation date.
async function testSellStockInDefaultUserAccountSessionMissingPriceDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: DEFAULT_ACCOUNT_DATE,
            cash: 0,
            positions: {
                AAPL: [{ quantity: 2, cost_per_share: 10, purchase_date: '2015-12-31' }],
            },
        },
        { cwd: () => tempRepoRoot }
    )

    await assert.rejects(
        () =>
            sellStockInDefaultUserAccountSession('AAPL', 1, {
                cwd: () => tempRepoRoot,
                getStockData: stockDataFetcher({
                    AAPL: { '2016-01-05': { close: 12 } },
                }),
            }),
        new RegExp(`No price data found for AAPL on ${DEFAULT_ACCOUNT_DATE}`)
    )
}

// Verify a sale spanning multiple purchase batches records one history row per batch, each tagged
// with its short/long holding term (including the exact one-year boundary, which stays short-term).
async function testSellStockRecordsPerBatchHistoryWithTerm(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const logFilePath = path.join(tempRepoRoot, HISTORY_LOG_RELATIVE_PATH)

    await writeDefaultUserAccountSession(
        {
            date: DEFAULT_ACCOUNT_DATE,
            cash: 0,
            positions: {
                AAPL: [
                    // Held well over a year before the 2001-01-02 sale date.
                    { quantity: 2, cost_per_share: 10, purchase_date: '1999-06-01' },
                    // Bought exactly one year before the sale: a one-year hold is still short-term.
                    { quantity: 1, cost_per_share: 11, purchase_date: '2000-01-02' },
                    // Bought on the sale date itself.
                    { quantity: 2, cost_per_share: 12, purchase_date: DEFAULT_ACCOUNT_DATE },
                ],
            },
        },
        { cwd: () => tempRepoRoot }
    )

    const result = await sellStockInDefaultUserAccountSession('AAPL', 4, {
        cwd: () => tempRepoRoot,
        getStockData: stockDataFetcher({
            AAPL: { [DEFAULT_ACCOUNT_DATE]: { close: 15 } },
        }),
    })

    assert.equal(result.quantity, 4)
    assert.equal(result.totalProceeds, 60)
    // The newest lot keeps its leftover share after the FIFO sale consumes the first two batches.
    assert.deepEqual(result.account.positions.AAPL, [{ quantity: 1, cost_per_share: 12, purchase_date: DEFAULT_ACCOUNT_DATE }])

    // Strip the leading timestamp from each line so the recorded batches can be compared directly.
    const recordedRows = (await fs.readFile(logFilePath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => line.slice(line.indexOf(' ') + 1))

    assert.deepEqual(recordedRows, [
        `SELL stock=AAPL qty=2 price=15.00 acquired=1999-06-01 term=LONG cash=+30.00 sim=${DEFAULT_ACCOUNT_DATE}`,
        `SELL stock=AAPL qty=1 price=15.00 acquired=2000-01-02 term=SHORT cash=+15.00 sim=${DEFAULT_ACCOUNT_DATE}`,
        `SELL stock=AAPL qty=1 price=15.00 acquired=${DEFAULT_ACCOUNT_DATE} term=SHORT cash=+15.00 sim=${DEFAULT_ACCOUNT_DATE}`,
    ])
}

// Run the focused sell action tests that protect date-based pricing and FIFO account mutations.
export async function runSellAccountActionTests(): Promise<void> {
    await testSellStockInDefaultUserAccountSessionInvalidQuantity()
    await testSellStockInDefaultUserAccountSession()
    await testSellStockInDefaultUserAccountSessionRemovesEmptyHolding()
    await testSellStockInDefaultUserAccountSessionInsufficientShares()
    await testSellStockInDefaultUserAccountSessionMissingPriceDate()
    await testSellStockRecordsPerBatchHistoryWithTerm()
}
