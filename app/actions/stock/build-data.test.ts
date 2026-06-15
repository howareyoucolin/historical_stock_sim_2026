import assert from 'node:assert/strict'

import {
    DATA_FILE_NAME,
    EPS_FILE_NAME,
    buildDataPayload,
    buildHistoryByDate,
    createBuildStockDataAction,
    derivePeRatio,
    findTrailingEps,
} from './build-data'
import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME } from './download-data'

const EPS_BY_DATE = {
    '2009-12-31': 0.37,
    '2010-03-31': 0.42,
    '2010-06-30': 0.47,
}

// Verify trailing EPS uses the latest quarter reported on or before the given day.
function testFindTrailingEps(): void {
    assert.equal(findTrailingEps(EPS_BY_DATE, '2010-05-01'), 0.42)
    assert.equal(findTrailingEps(EPS_BY_DATE, '2010-03-31'), 0.42)
    assert.equal(findTrailingEps(EPS_BY_DATE, '2010-07-01'), 0.47)
}

// Verify days before the first reported quarter have no trailing EPS.
function testFindTrailingEpsBeforeFirstQuarter(): void {
    assert.equal(findTrailingEps(EPS_BY_DATE, '2009-01-01'), null)
}

// Verify the PE ratio is derived from price and EPS, and is null when an input is missing or zero.
function testDerivePeRatio(): void {
    assert.equal(derivePeRatio(8.4, 0.42), 20)
    assert.equal(derivePeRatio(null, 0.42), null)
    assert.equal(derivePeRatio(8.4, null), null)
    assert.equal(derivePeRatio(8.4, 0), null)
}

// Verify each daily row is enriched with trailing EPS and a derived PE ratio.
function testBuildHistoryByDate(): void {
    const merged = buildHistoryByDate(
        {
            '2010-04-01': { close: 8.4, isPayoutDate: false, dividendPerShare: 0 },
            '2009-06-30': { close: 3.7, isPayoutDate: false, dividendPerShare: 0 },
        },
        EPS_BY_DATE
    )

    assert.deepEqual(merged['2010-04-01'], {
        close: 8.4,
        isPayoutDate: false,
        dividendPerShare: 0,
        ttmEps: 0.42,
        peRatio: 20,
    })
    // Day before the first reported quarter carries null EPS and PE.
    assert.deepEqual(merged['2009-06-30'], {
        close: 3.7,
        isPayoutDate: false,
        dividendPerShare: 0,
        ttmEps: null,
        peRatio: null,
    })
}

// Verify the persisted payload spans the full price range and records both sources.
function testBuildDataPayload(): void {
    const payload = buildDataPayload(
        'AAPL',
        {
            stockCode: 'AAPL',
            source: 'Yahoo Finance',
            historyByDate: {
                '2010-06-30': { close: 9.4, isPayoutDate: false, dividendPerShare: 0 },
                '2010-04-01': { close: 8.4, isPayoutDate: false, dividendPerShare: 0 },
            },
        },
        { stockCode: 'AAPL', source: 'Macrotrends', sourceUrl: 'https://example.com', metric: 'TTM Net EPS', epsByDate: EPS_BY_DATE }
    )

    assert.deepEqual(payload.range, { start: '2010-04-01', end: '2010-06-30' })
    assert.equal(payload.sources.priceHistory.source, 'Yahoo Finance')
    assert.equal(payload.sources.eps.source, 'Macrotrends')
    assert.equal(payload.historyByDate['2010-06-30'].ttmEps, 0.47)
}

// Verify the action reads both source files and writes the combined data file.
async function testBuildStockDataAction(): Promise<void> {
    const reads: string[] = []
    const captured = { writePath: null as string | null, writeContents: null as string | null }

    const buildStockDataAction = createBuildStockDataAction({
        cwd: () => '/repo',
        readFile: async (filePath) => {
            reads.push(filePath)

            if (filePath.endsWith(HISTORY_FILE_NAME)) {
                return JSON.stringify({
                    stockCode: 'AAPL',
                    source: 'Yahoo Finance',
                    historyByDate: { '2010-04-01': { close: 8.4, isPayoutDate: false, dividendPerShare: 0 } },
                })
            }

            return JSON.stringify({ stockCode: 'AAPL', source: 'Macrotrends', epsByDate: EPS_BY_DATE })
        },
        makeDirectory: async () => {},
        writeFile: async (filePath, contents) => {
            captured.writePath = filePath
            captured.writeContents = contents
        },
    })

    const result = await buildStockDataAction('aapl')
    const parsed = JSON.parse(captured.writeContents || '{}') as {
        historyByDate: Record<string, { ttmEps: number | null; peRatio: number | null }>
    }

    assert.equal(result.stockCode, 'AAPL')
    assert.equal(result.rowCount, 1)
    assert.equal(result.outputPath, `${DATA_DIRECTORY_NAME}/AAPL/${DATA_FILE_NAME}`)
    assert.equal(captured.writePath, `/repo/${DATA_DIRECTORY_NAME}/AAPL/${DATA_FILE_NAME}`)
    assert.deepEqual(parsed.historyByDate['2010-04-01'], { close: 8.4, isPayoutDate: false, dividendPerShare: 0, ttmEps: 0.42, peRatio: 20 })
    assert.ok(reads.some((p) => p.endsWith(HISTORY_FILE_NAME)))
    assert.ok(reads.some((p) => p.endsWith(EPS_FILE_NAME)))
}

// Verify a missing source file produces a clear, actionable error.
async function testBuildStockDataActionMissingSource(): Promise<void> {
    const buildStockDataAction = createBuildStockDataAction({
        cwd: () => '/repo',
        readFile: async () => {
            throw new Error('ENOENT')
        },
    })

    await assert.rejects(buildStockDataAction('AAPL'), /Missing price history file/)
}

// Run the focused action tests that protect the reusable stock build logic.
export async function runBuildDataActionTests(): Promise<void> {
    testFindTrailingEps()
    testFindTrailingEpsBeforeFirstQuarter()
    testDerivePeRatio()
    testBuildHistoryByDate()
    testBuildDataPayload()
    await testBuildStockDataAction()
    await testBuildStockDataActionMissingSource()
}
