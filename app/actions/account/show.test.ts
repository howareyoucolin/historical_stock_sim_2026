import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { stockDataFetcher } from '../../test-helpers/market-data'
import { createDefaultAccountState, DEFAULT_USER_SESSION_RELATIVE_PATH, readDefaultUserAccountSession, writeDefaultUserAccountSession } from './model'
import { buildDefaultUserAccountSessionView, fetchDefaultUserAccountSession, showDefaultUserAccountSession } from './show'

const DEFAULT_ACCOUNT_STATE = createDefaultAccountState()

// Build a temporary repo root so show action tests can read an isolated session file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
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

    const account = await fetchDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
    })
    const savedAccount = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot })

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

    const output = await showDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
        getStockData: stockDataFetcher({
            AAPL: { '2018-03-10': { close: 150 } },
            MSFT: { '2018-03-10': { close: 40 } },
        }),
    })

    assert.equal(
        output,
        [
            'Date: 2018-03-10',
            'Cash: 1200.00',
            'Basis: 530.00 | Value: 610.00 | P/L: 80.00 | P/L%: 15.09%',
            '',
            'stock_code | average_cost | current_price | pe_ratio | quantity | total_value | total_gain_loss | percent_gain_loss',
            '-----------+--------------+---------------+----------+----------+-------------+-----------------+------------------',
            'AAPL       |       110.00 |        150.00 |        - |        3 |      450.00 |          120.00 |            36.36%',
            'MSFT       |        50.00 |         40.00 |        - |        4 |      160.00 |          -40.00 |           -20.00%',
        ].join('\n')
    )
}

// Verify the show action renders the PE ratio from the fetched market data, with a dash when EPS is unavailable (e.g. ETFs).
async function testShowDefaultUserAccountSessionIncludesPeRatio(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2018-03-10',
            cash: 1200,
            positions: {
                AAPL: [{ quantity: 2, cost_per_share: 100, purchase_date: '2018-03-01' }],
                SPY: [{ quantity: 1, cost_per_share: 250, purchase_date: '2018-03-01' }],
            },
        },
        { cwd: () => tempRepoRoot }
    )

    const output = await showDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
        getStockData: stockDataFetcher({
            AAPL: { '2018-03-10': { close: 150, ttmEps: 8.14, peRatio: 18.42 } },
            SPY: { '2018-03-10': { close: 270, ttmEps: null, peRatio: null } },
        }),
    })

    assert.equal(
        output,
        [
            'Date: 2018-03-10',
            'Cash: 1200.00',
            'Basis: 450.00 | Value: 570.00 | P/L: 120.00 | P/L%: 26.67%',
            '',
            'stock_code | average_cost | current_price | pe_ratio | quantity | total_value | total_gain_loss | percent_gain_loss',
            '-----------+--------------+---------------+----------+----------+-------------+-----------------+------------------',
            'AAPL       |       100.00 |        150.00 |    18.42 |        2 |      300.00 |          100.00 |            50.00%',
            'SPY        |       250.00 |        270.00 |        - |        1 |      270.00 |           20.00 |             8.00%',
        ].join('\n')
    )
}

// Verify the view computes day-change, % of group, and purchase date from the prior trading day.
async function testBuildViewComputesDayChangeAndGroup(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    const view = await buildDefaultUserAccountSessionView(
        {
            date: '2018-03-10',
            cash: 0,
            positions: {
                AAPL: [{ quantity: 2, cost_per_share: 100, purchase_date: '2018-03-01' }],
                MSFT: [{ quantity: 4, cost_per_share: 40, purchase_date: '2018-03-05' }],
            },
        },
        {
            cwd: () => tempRepoRoot,
            getStockData: stockDataFetcher({
                AAPL: {
                    '2018-03-09': { close: 140, ttmEps: 8, peRatio: 17.5 },
                    '2018-03-10': { close: 150, ttmEps: 8, peRatio: 18.75 },
                },
                MSFT: {
                    '2018-03-09': { close: 42, ttmEps: 3, peRatio: 14 },
                    '2018-03-10': { close: 40, ttmEps: 3, peRatio: 13.3 },
                },
            }),
        }
    )

    const [aapl, msft] = view.rows

    assert.equal(aapl.priceChange, 10)
    assert.equal(aapl.dayChangeValue, 20)
    assert.equal(aapl.purchaseDate, '2018-03-01')
    assert.equal(aapl.percentOfGroup.toFixed(2), '65.22') // 300 / (300 + 160)
    assert.equal(msft.priceChange, -2)
    assert.equal(msft.dayChangeValue, -8)
    assert.equal(view.summary.totalDayChange, 12)
}

// Verify each holding carries its purchase lots, sorted oldest first with per-lot gain/loss figures.
async function testBuildViewBreaksDownLots(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    const view = await buildDefaultUserAccountSessionView(
        {
            date: '2018-03-10',
            cash: 0,
            positions: {
                AAPL: [
                    { quantity: 4, cost_per_share: 120, purchase_date: '2018-03-05' },
                    { quantity: 2, cost_per_share: 100, purchase_date: '2018-03-01' },
                ],
            },
        },
        {
            cwd: () => tempRepoRoot,
            getStockData: stockDataFetcher({
                AAPL: { '2018-03-10': { close: 150, ttmEps: 8, peRatio: 18.75 } },
            }),
        }
    )

    const [aapl] = view.rows

    // Lots are surfaced oldest first regardless of stored order.
    assert.deepEqual(
        aapl.lots.map((lot) => lot.purchaseDate),
        ['2018-03-01', '2018-03-05']
    )

    const [older, newer] = aapl.lots

    assert.equal(older.quantity, 2)
    assert.equal(older.totalCost, 200)
    assert.equal(older.marketValue, 300)
    assert.equal(older.gainLoss, 100)
    assert.equal(older.percentGainLoss, 50)

    assert.equal(newer.totalCost, 480) // 4 shares * 120 cost
    assert.equal(newer.gainLoss, 120) // 4 * 150 market value 600 - 480 cost
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
    await testShowDefaultUserAccountSessionIncludesPeRatio()
    await testBuildViewComputesDayChangeAndGroup()
    await testBuildViewBreaksDownLots()
    await testShowDefaultUserAccountSessionWithoutTrackedStocks()
}
