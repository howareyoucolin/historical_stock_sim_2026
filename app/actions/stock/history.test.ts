import assert from 'node:assert/strict'
import path from 'node:path'

import { buildStockHistory, selectHistoryRowsThroughDate, showStockHistory } from './history'
import { stockDataFetcher } from '../../test-helpers/market-data'
import { DEFAULT_USER_SESSION_META_RELATIVE_PATH, DEFAULT_USER_SESSION_RELATIVE_PATH } from '../account/model'

const DATA_ENTRY = { isPayoutDate: false, dividendPerShare: 0, ttmEps: 0.37, peRatio: 20.66 }

const HISTORY_BY_DATE = {
    '2010-01-05': { close: 7.66, ...DATA_ENTRY },
    '2010-01-04': { close: 7.64, ...DATA_ENTRY },
    '2010-01-06': { close: 7.53, ...DATA_ENTRY },
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

// Verify the selector keeps only days on or before the cutoff and orders them oldest first.
function testSelectHistoryRowsThroughDate(): void {
    const rows = selectHistoryRowsThroughDate(HISTORY_BY_DATE, '2010-01-05')

    assert.deepEqual(
        rows.map((row) => row.date),
        ['2010-01-04', '2010-01-05']
    )
    assert.equal(rows[0].close, 7.64)
}

// Verify the cutoff itself is inclusive when it exactly matches a recorded day.
function testSelectHistoryRowsIncludesCutoffDay(): void {
    const rows = selectHistoryRowsThroughDate(HISTORY_BY_DATE, '2010-01-06')

    assert.equal(rows.length, 3)
    assert.equal(rows[rows.length - 1].date, '2010-01-06')
}

// Verify the action reads the account date, loads the data file, and spans start-through-date.
async function testBuildStockHistory(): Promise<void> {
    const result = await buildStockHistory('aapl', createDependencies('2010-01-05', HISTORY_BY_DATE))

    assert.equal(result.stockCode, 'AAPL')
    assert.equal(result.throughDate, '2010-01-05')
    assert.deepEqual(
        result.rows.map((row) => row.date),
        ['2010-01-04', '2010-01-05']
    )
}

// Verify the rendered table carries the heading, header row, and one line per included day.
async function testShowStockHistory(): Promise<void> {
    const output = await showStockHistory('AAPL', createDependencies('2010-01-05', HISTORY_BY_DATE))

    assert.match(output, /History for AAPL from 2010-01-04 to 2010-01-05 \(2 trading days\):/)
    assert.match(output, /date\s+\|\s+close\s+\|\s+ttm_eps\s+\|\s+pe_ratio\s+\|\s+dividend/)
    assert.match(output, /2010-01-04/)
    assert.match(output, /2010-01-05/)
    assert.doesNotMatch(output, /2010-01-06/)
}

// Verify a friendly placeholder is returned when the account date precedes all recorded data.
async function testShowStockHistoryBeforeData(): Promise<void> {
    const output = await showStockHistory('AAPL', createDependencies('2009-01-01', HISTORY_BY_DATE))

    assert.equal(output, 'No history for AAPL on or before 2009-01-01.')
}

// Verify an unknown symbol (no market data from the API) surfaces a clear "not tradable" error.
async function testShowStockHistoryUnknownSymbol(): Promise<void> {
    const dependencies = {
        cwd: () => '/repo',
        readFile: async () => JSON.stringify({ date: '2010-01-05', cash: 0, positions: {} }),
        getStockData: stockDataFetcher({}),
    }

    await assert.rejects(
        showStockHistory('AAPL', dependencies),
        /No market data found for AAPL\. It may not be a tradable symbol\./
    )
}

// Run the focused action tests that protect the stock history view logic.
export async function runStockHistoryActionTests(): Promise<void> {
    testSelectHistoryRowsThroughDate()
    testSelectHistoryRowsIncludesCutoffDay()
    await testBuildStockHistory()
    await testShowStockHistory()
    await testShowStockHistoryBeforeData()
    await testShowStockHistoryUnknownSymbol()
}
