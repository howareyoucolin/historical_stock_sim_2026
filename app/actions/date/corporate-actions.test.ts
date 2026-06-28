import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { HISTORY_LOG_RELATIVE_PATH } from '../history/log'
import { readDefaultUserAccountSession, writeDefaultUserAccountSession } from '../account/model'
import { advanceSimulationDate } from './advance'
import { stockDataFetcher } from '../../test-helpers/market-data'

// Build a temporary repo root so corporate-action tests can mutate isolated session and log files.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Read the normalized history log rows without their real-world timestamps so assertions stay stable.
async function readHistoryRows(tempRepoRoot: string): Promise<string[]> {
    const contents = await fs.readFile(path.join(tempRepoRoot, HISTORY_LOG_RELATIVE_PATH), 'utf8')

    return contents
        .trim()
        .split('\n')
        .map((line) => line.slice(line.indexOf(' ') + 1))
}

// Verify a cash buyout removes the holding, credits cash, and records a corporate-action history row.
async function testAdvanceSimulationDateAppliesCashBuyout(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2022-10-27',
            cash: 100,
            positions: { TWTR: [{ quantity: 10, cost_per_share: 45, purchase_date: '2022-01-10' }] },
        },
        { cwd: () => tempRepoRoot }
    )

    const result = await advanceSimulationDate(null, {
        cwd: () => tempRepoRoot,
        getTradingCalendar: async () => ['2022-10-27', '2022-10-28'],
        getStockData: stockDataFetcher({ TWTR: { '2022-10-27': { close: 53 }, '2022-10-28': { close: 54.2 } } }),
        getCorporateActions: async () => [{ stockCode: 'TWTR', date: '2022-10-28', type: 'cash_buyout', cashPerShare: 54.2, note: 'Taken private for cash.' }],
    })
    const savedAccount = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    assert.equal(result.account.date, '2022-10-28')
    assert.equal(result.account.cash, 642)
    assert.deepEqual(result.account.positions, {})
    assert.deepEqual(savedAccount, result.account)
    assert.equal(result.corporateActions?.length, 1)
    assert.equal(result.corporateActions?.[0].cashDelta, 542)
    assert.deepEqual(await readHistoryRows(tempRepoRoot), [
        'CORPORATE_ACTION stock=TWTR qty=10 price=54.20 cash=+542.00 sim=2022-10-28 note="Taken private for cash."',
    ])
}

// Verify a stock-for-stock merger converts the held lots into the acquirer and pays cash for any fraction.
async function testAdvanceSimulationDateAppliesStockSwap(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2022-02-11',
            cash: 0,
            positions: { XLNX: [{ quantity: 3, cost_per_share: 60, purchase_date: '2021-04-01' }] },
        },
        { cwd: () => tempRepoRoot }
    )

    const result = await advanceSimulationDate(null, {
        cwd: () => tempRepoRoot,
        getTradingCalendar: async () => ['2022-02-11', '2022-02-14'],
        getStockData: stockDataFetcher({
            XLNX: { '2022-02-11': { close: 200 }, '2022-02-14': { close: 210 } },
            AMD: { '2022-02-11': { close: 110 }, '2022-02-14': { close: 108 } },
        }),
        getCorporateActions: async () => [{ stockCode: 'XLNX', date: '2022-02-14', type: 'stock_swap', acquirerStockCode: 'AMD', shareRatio: 1.5, cashPerShare: 100, note: 'Converted into AMD with cash for the fractional share.' }],
    })

    assert.equal(result.account.date, '2022-02-14')
    assert.equal(result.account.cash, 50)
    assert.equal(result.account.positions.XLNX, undefined)
    assert.deepEqual(result.account.positions.AMD, [{ quantity: 4, cost_per_share: 40, purchase_date: '2021-04-01' }])
    assert.equal(result.corporateActions?.[0].cashDelta, 50)
}

// Verify an equity wipeout removes the holding without crediting cash and still leaves an audit trail.
async function testAdvanceSimulationDateAppliesEquityWipeout(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2023-05-01',
            cash: 20,
            positions: { FRC: [{ quantity: 2, cost_per_share: 40, purchase_date: '2023-03-15' }] },
        },
        { cwd: () => tempRepoRoot }
    )

    const result = await advanceSimulationDate(null, {
        cwd: () => tempRepoRoot,
        getTradingCalendar: async () => ['2023-05-01', '2023-05-02'],
        getStockData: stockDataFetcher({ FRC: { '2023-05-01': { close: 3.5 }, '2023-05-02': { close: 0.5 } } }),
        getCorporateActions: async () => [{ stockCode: 'FRC', date: '2023-05-02', type: 'equity_wipeout', note: 'Common equity wiped out.' }],
    })

    assert.equal(result.account.cash, 20)
    assert.deepEqual(result.account.positions, {})
    assert.equal(result.corporateActions?.[0].cashDelta, 0)
    assert.deepEqual(await readHistoryRows(tempRepoRoot), [
        'CORPORATE_ACTION stock=FRC qty=2 price=0.00 cash=+0.00 sim=2023-05-02 note="Common equity wiped out."',
    ])
}

// Verify an OTC continuation logs the event but keeps the shares in the account until a later exit event.
async function testAdvanceSimulationDateAppliesOtcContinuationAsNoOp(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2023-05-02',
            cash: 0,
            positions: { BBBY: [{ quantity: 10, cost_per_share: 1, purchase_date: '2023-04-10' }] },
        },
        { cwd: () => tempRepoRoot }
    )

    const result = await advanceSimulationDate(null, {
        cwd: () => tempRepoRoot,
        getTradingCalendar: async () => ['2023-05-02', '2023-05-03'],
        getStockData: stockDataFetcher({ BBBY: { '2023-05-02': { close: 0.18 }, '2023-05-03': { close: 0.1 } } }),
        getCorporateActions: async () => [{ stockCode: 'BBBY', date: '2023-05-03', type: 'otc_continuation', note: 'Moved to OTC; repricing is not modeled locally.' }],
    })

    assert.deepEqual(result.account.positions.BBBY, [{ quantity: 10, cost_per_share: 1, purchase_date: '2023-04-10' }])
    assert.equal(result.corporateActions?.[0].cashDelta, 0)
}

// Run the focused corporate-action tests that protect buyouts, mergers, wipeouts, and OTC moves.
export async function runCorporateActionDateAdvanceTests(): Promise<void> {
    await testAdvanceSimulationDateAppliesCashBuyout()
    await testAdvanceSimulationDateAppliesStockSwap()
    await testAdvanceSimulationDateAppliesEquityWipeout()
    await testAdvanceSimulationDateAppliesOtcContinuationAsNoOp()
}
