import assert from 'node:assert/strict'
import path from 'node:path'

import { DATA_FILE_NAME } from './build-data'
import { DATA_DIRECTORY_NAME } from './download-data'
import { buildStockList, buildStockListEntries, showStockList } from './list'

// Build a deps object whose readers report a fixed set of entries and which of them carry data.json.
function createDependencies(entries: string[], built: string[]) {
    const builtSet = new Set(built)

    return {
        cwd: () => '/repo',
        readDirectory: async (dirPath: string) => {
            assert.equal(dirPath, path.join('/repo', DATA_DIRECTORY_NAME))

            return entries
        },
        fileExists: async (filePath: string) => {
            const code = path.basename(path.dirname(filePath))

            assert.equal(path.basename(filePath), DATA_FILE_NAME)

            return builtSet.has(code)
        },
    }
}

// Verify only entries with a built data.json are listed, sorted alphabetically.
async function testBuildStockListKeepsBuiltOnly(): Promise<void> {
    const codes = await buildStockList(createDependencies(['MSFT', 'AAPL', 'README.md', 'TSLA'], ['MSFT', 'AAPL', 'TSLA']))

    assert.deepEqual(codes, ['AAPL', 'MSFT', 'TSLA'])
}

// Verify a missing market-data directory yields an empty list rather than throwing.
async function testBuildStockListMissingDirectory(): Promise<void> {
    const codes = await buildStockList({
        cwd: () => '/repo',
        readDirectory: async () => {
            const error = new Error('missing') as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
        },
    })

    assert.deepEqual(codes, [])
}

// Verify the rendered listing reports the count and includes each available code.
async function testShowStockList(): Promise<void> {
    const output = await showStockList(createDependencies(['AAPL', 'MSFT', 'TSLA'], ['AAPL', 'MSFT', 'TSLA']))

    assert.match(output, /3 stocks available:/)
    assert.match(output, /AAPL/)
    assert.match(output, /MSFT/)
    assert.match(output, /TSLA/)
}

// Verify an empty market-data directory points the user at the seed command.
async function testShowStockListEmpty(): Promise<void> {
    const output = await showStockList(createDependencies([], []))

    assert.equal(output, 'No stocks available. Run `stock seed` to download the watchlist.')
}

// Verify list entries include the stock code and a curated fallback-safe segment for filtering.
async function testBuildStockListEntries(): Promise<void> {
    const entries = await buildStockListEntries(createDependencies(['MSFT', 'AAPL', 'TSLA'], ['AAPL', 'MSFT', 'TSLA']))

    assert.deepEqual(
        entries.map((entry) => entry.code),
        ['AAPL', 'MSFT', 'TSLA'],
    )
    assert.equal(entries[0].segment, 'Consumer Technology')
}

// Run the focused action tests that protect the stock listing logic.
export async function runStockListActionTests(): Promise<void> {
    await testBuildStockListKeepsBuiltOnly()
    await testBuildStockListMissingDirectory()
    await testBuildStockListEntries()
    await testShowStockList()
    await testShowStockListEmpty()
}
