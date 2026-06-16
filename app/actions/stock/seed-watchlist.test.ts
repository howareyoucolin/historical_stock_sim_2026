import assert from 'node:assert/strict'

import { TICKERS_FILE, createSeedWatchlistAction } from './seed-watchlist'

// Verify each ticker runs all three steps and outcomes (ok/skipped/failed) are recorded.
async function testSeedWatchlistAction(): Promise<void> {
    const logs: string[] = []
    const seedWatchlistAction = createSeedWatchlistAction({
        cwd: () => '/repo',
        readFile: async () => JSON.stringify(['AAPL', 'MSFT']),
        downloadStockData: async (stockCode) => ({ skipped: false, rowCount: 10, outputPath: `market-data/${stockCode}/history.json` }),
        scrapeEps: async (stockCode) => ({ skipped: true, stockCode, outputPath: `market-data/${stockCode}/eps.json` }),
        buildStockData: async (stockCode) => {
            if (stockCode === 'MSFT') {
                throw new Error('boom')
            }

            return { skipped: false, rowCount: 5, outputPath: `market-data/${stockCode}/data.json` }
        },
    })

    const summary = await seedWatchlistAction((message) => logs.push(message))

    assert.equal(summary.tickersFile, TICKERS_FILE)
    assert.deepEqual(summary.tickers, ['AAPL', 'MSFT'])
    assert.deepEqual(summary.results[0], { stockCode: 'AAPL', download: 'ok', scrapeEps: 'skipped', build: 'ok' })
    assert.deepEqual(summary.results[1], { stockCode: 'MSFT', download: 'ok', scrapeEps: 'skipped', build: 'failed' })
    assert.ok(logs.some((line) => line.includes('[1/2] AAPL')))
    assert.ok(logs.some((line) => line.includes('build: failed (boom)')))
}

// Verify a missing watchlist file produces a clear, actionable error.
async function testSeedWatchlistMissingFile(): Promise<void> {
    const seedWatchlistAction = createSeedWatchlistAction({
        readFile: async () => {
            throw new Error('ENOENT')
        },
    })

    await assert.rejects(seedWatchlistAction(), /Missing ticker list file/)
}

// Verify a watchlist that is not an array of strings is rejected before any work runs.
async function testSeedWatchlistRejectsNonArray(): Promise<void> {
    const seedWatchlistAction = createSeedWatchlistAction({
        readFile: async () => JSON.stringify({ tickers: ['AAPL'] }),
    })

    await assert.rejects(seedWatchlistAction(), /must be a JSON array of strings/)
}

// Run the focused action tests that protect the watchlist seed loop.
export async function runSeedWatchlistActionTests(): Promise<void> {
    await testSeedWatchlistAction()
    await testSeedWatchlistMissingFile()
    await testSeedWatchlistRejectsNonArray()
}
