import assert from 'node:assert/strict'

import { buildStockList, buildStockListEntries, showStockList } from './list'

// Build a deps object whose listStockCodes fake returns a fixed set of codes from the market-data API.
function createDependencies(codes: string[]) {
    return {
        cwd: () => '/repo',
        listStockCodes: async () => codes,
    }
}

// Verify malformed symbols are skipped and the rest are returned sorted alphabetically.
async function testBuildStockListKeepsValidOnly(): Promise<void> {
    const codes = await buildStockList(createDependencies(['MSFT', 'AAPL', 'BRK B', 'TSLA']))

    assert.deepEqual(codes, ['AAPL', 'MSFT', 'TSLA'])
}

// Verify an empty source (e.g. unseeded market data) yields an empty list rather than throwing.
async function testBuildStockListEmptySource(): Promise<void> {
    const codes = await buildStockList(createDependencies([]))

    assert.deepEqual(codes, [])
}

// Verify the rendered listing reports the count and includes each available code.
async function testShowStockList(): Promise<void> {
    const output = await showStockList(createDependencies(['AAPL', 'MSFT', 'TSLA']))

    assert.match(output, /3 stocks available:/)
    assert.match(output, /AAPL/)
    assert.match(output, /MSFT/)
    assert.match(output, /TSLA/)
}

// Verify an empty source points the user at the seed command.
async function testShowStockListEmpty(): Promise<void> {
    const output = await showStockList(createDependencies([]))

    assert.equal(output, 'No stocks available. Check that the market-data API/database is reachable.')
}

// Verify list entries pair each (valid, sorted) code with its segment (DB sector) from the bulk fetch.
async function testBuildStockListEntries(): Promise<void> {
    const entries = await buildStockListEntries({
        listStockEntries: async () => [
            { code: 'MSFT', segment: 'Information Technology' },
            { code: 'AAPL', segment: 'Information Technology' },
            { code: 'BRK B', segment: 'Financials' },
            { code: 'TSLA', segment: 'Consumer Discretionary' },
        ],
    })

    // Malformed code (BRK B) skipped; rest sorted alphabetically with their segments.
    assert.deepEqual(entries, [
        { code: 'AAPL', segment: 'Information Technology' },
        { code: 'MSFT', segment: 'Information Technology' },
        { code: 'TSLA', segment: 'Consumer Discretionary' },
    ])
}

// Run the focused action tests that protect the stock listing logic.
export async function runStockListActionTests(): Promise<void> {
    await testBuildStockListKeepsValidOnly()
    await testBuildStockListEmptySource()
    await testBuildStockListEntries()
    await testShowStockList()
    await testShowStockListEmpty()
}
