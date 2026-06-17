import assert from 'node:assert/strict'
import path from 'node:path'

import { buildStockAnalysis } from './analysis'
import { DATA_FILE_NAME } from './build-data'
import { DATA_DIRECTORY_NAME } from './download-data'
import { DEFAULT_USER_SESSION_RELATIVE_PATH } from '../account/model'

// A small priced series spanning just over a year so the 52-week window has something to exclude.
const HISTORY_BY_DATE = {
    '2018-11-15': { close: 50, isPayoutDate: false, dividendPerShare: 0, ttmEps: 4, peRatio: 12.5 },
    '2019-06-03': { close: 90, isPayoutDate: true, dividendPerShare: 0.25, ttmEps: 5, peRatio: 18 },
    '2019-12-02': { close: 70, isPayoutDate: false, dividendPerShare: 0, ttmEps: 6, peRatio: 11.67 },
    '2019-12-03': { close: 72, isPayoutDate: false, dividendPerShare: 0, ttmEps: 6, peRatio: 12 },
}

// Build a deps object whose readers return the account session and data file for the given fixtures.
function createDependencies(accountDate: string, dataFile: unknown) {
    return {
        cwd: () => '/repo',
        readFile: async (filePath: string) => {
            assert.equal(filePath, path.join('/repo', DEFAULT_USER_SESSION_RELATIVE_PATH))

            return JSON.stringify({ date: accountDate, cash: 0, positions: {} })
        },
        readMarketDataFile: async (filePath: string) => {
            assert.equal(filePath, path.join('/repo', DATA_DIRECTORY_NAME, 'AAPL', DATA_FILE_NAME))

            return JSON.stringify(dataFile)
        },
    }
}

// Verify the snapshot reports the as-of close, the day change vs the prior close, and the series.
async function testBuildStockAnalysisCoreFigures(): Promise<void> {
    const analysis = await buildStockAnalysis('aapl', createDependencies('2019-12-03', { historyByDate: HISTORY_BY_DATE }))

    assert.ok(analysis)
    assert.equal(analysis.stockCode, 'AAPL')
    assert.equal(analysis.asOfDate, '2019-12-03')
    assert.equal(analysis.close, 72)
    assert.equal(analysis.previousClose, 70)
    assert.equal(analysis.change, 2)
    assert.equal(analysis.peRatio, 12)
    assert.equal(analysis.points.length, 4)
    assert.equal(analysis.points[0].date, '2018-11-15')
}

// Verify the 52-week range excludes closes older than a year and the latest dividend is reported.
async function testBuildStockAnalysisWindowAndDividend(): Promise<void> {
    const analysis = await buildStockAnalysis('AAPL', createDependencies('2019-12-03', { historyByDate: HISTORY_BY_DATE }))

    assert.ok(analysis)
    // 2018-11-15 (close 50) is more than 365 days before 2019-12-03, so it drops out of the window.
    assert.equal(analysis.high52, 90)
    assert.equal(analysis.low52, 70)
    assert.equal(analysis.lastDividendPerShare, 0.25)
    assert.equal(analysis.lastDividendDate, '2019-06-03')
}

// Verify the snapshot stops at the simulation date, ignoring later recorded days.
async function testBuildStockAnalysisRespectsSimDate(): Promise<void> {
    const analysis = await buildStockAnalysis('AAPL', createDependencies('2019-06-03', { historyByDate: HISTORY_BY_DATE }))

    assert.ok(analysis)
    assert.equal(analysis.asOfDate, '2019-06-03')
    assert.equal(analysis.close, 90)
    assert.equal(analysis.points.length, 2)
}

// Verify a simulation date before any priced day yields no analysis.
async function testBuildStockAnalysisBeforeData(): Promise<void> {
    const analysis = await buildStockAnalysis('AAPL', createDependencies('2010-01-01', { historyByDate: HISTORY_BY_DATE }))

    assert.equal(analysis, null)
}

// Run the focused action tests that protect the stock analysis snapshot logic.
export async function runStockAnalysisActionTests(): Promise<void> {
    await testBuildStockAnalysisCoreFigures()
    await testBuildStockAnalysisWindowAndDividend()
    await testBuildStockAnalysisRespectsSimDate()
    await testBuildStockAnalysisBeforeData()
}
