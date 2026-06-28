import assert from 'node:assert/strict'
import path from 'node:path'

import { buildStockStatus, showStockStatus } from './status'
import { stockDataFetcher } from '../../test-helpers/market-data'
import { DEFAULT_USER_SESSION_META_RELATIVE_PATH, DEFAULT_USER_SESSION_RELATIVE_PATH } from '../account/model'

const HISTORY_BY_DATE = {
    '2010-01-04': { close: 7.64, isPayoutDate: false, dividendPerShare: 0, ttmEps: 0.37, peRatio: 20.66 },
    '2010-01-05': { close: 7.8, isPayoutDate: false, dividendPerShare: 0, ttmEps: 0.37, peRatio: 21.08 },
    '2010-01-06': { close: 7.53, isPayoutDate: true, dividendPerShare: 0.42, ttmEps: 0.37, peRatio: 20.35 },
}

// Build a deps object whose account reader returns the pinned sim date and whose getStockData fake
// serves AAPL's in-memory daily series. The account session still comes from files under cwd.
function createDependencies(accountDate: string, historyByDate: typeof HISTORY_BY_DATE) {
    return {
        cwd: () => '/repo',
        readFile: async (filePath: string) => {
            // The account state is read from two files; the sim date the tests pin lives in the meta file.
            if (filePath === path.join('/repo', DEFAULT_USER_SESSION_META_RELATIVE_PATH)) {
                return JSON.stringify({ date: accountDate, updated_at: '2020-01-01T00:00:00.000Z' })
            }

            assert.equal(filePath, path.join('/repo', DEFAULT_USER_SESSION_RELATIVE_PATH))

            return JSON.stringify({ cash: 0, positions: {} })
        },
        getStockData: stockDataFetcher({ AAPL: historyByDate }),
    }
}

// Verify status resolves the sim date's row and the prior trading day's close for the change figure.
async function testBuildStockStatusOnTradingDay(): Promise<void> {
    const status = await buildStockStatus('aapl', createDependencies('2010-01-05', HISTORY_BY_DATE))

    assert.equal(status.stockCode, 'AAPL')
    assert.equal(status.simDate, '2010-01-05')
    assert.equal(status.asOfDate, '2010-01-05')
    assert.equal(status.row?.close, 7.8)
    assert.equal(status.previousClose, 7.64)
}

// Verify a non-trading sim date falls back to the most recent prior trading day.
async function testBuildStockStatusFallsBackToPriorDay(): Promise<void> {
    const status = await buildStockStatus('AAPL', createDependencies('2010-01-09', HISTORY_BY_DATE))

    assert.equal(status.simDate, '2010-01-09')
    assert.equal(status.asOfDate, '2010-01-06')
    assert.equal(status.row?.close, 7.53)
}

// Verify a sim date before any recorded data yields an empty snapshot.
async function testBuildStockStatusBeforeData(): Promise<void> {
    const status = await buildStockStatus('AAPL', createDependencies('2009-01-01', HISTORY_BY_DATE))

    assert.equal(status.row, null)
    assert.equal(status.asOfDate, null)
}

// Verify the rendered snapshot reports each field, the change, and an as-of note for stale dates.
async function testShowStockStatus(): Promise<void> {
    const onDate = await showStockStatus('AAPL', createDependencies('2010-01-05', HISTORY_BY_DATE))

    assert.match(onDate, /AAPL status on 2010-01-05:/)
    assert.match(onDate, /close:\s+7\.80/)
    assert.match(onDate, /change:\s+\+0\.16/)
    assert.match(onDate, /pe_ratio:\s+21\.08/)
    assert.match(onDate, /dividend: - \(no payout\)/)

    const staleDate = await showStockStatus('AAPL', createDependencies('2010-01-09', HISTORY_BY_DATE))

    assert.match(staleDate, /AAPL status on 2010-01-09 \(as of 2010-01-06\):/)
    assert.match(staleDate, /dividend: 0\.42 \(payout\)/)
}

// Verify a sim date before any data returns a friendly placeholder rather than a snapshot.
async function testShowStockStatusBeforeData(): Promise<void> {
    const output = await showStockStatus('AAPL', createDependencies('2009-01-01', HISTORY_BY_DATE))

    assert.equal(output, 'No data for AAPL on or before 2009-01-01.')
}

// Run the focused action tests that protect the stock status snapshot logic.
export async function runStockStatusActionTests(): Promise<void> {
    await testBuildStockStatusOnTradingDay()
    await testBuildStockStatusFallsBackToPriorDay()
    await testBuildStockStatusBeforeData()
    await testShowStockStatus()
    await testShowStockStatusBeforeData()
}
