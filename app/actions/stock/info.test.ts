import assert from 'node:assert/strict'

import { buildStockInfo, formatStockInfo } from './info'

// Verify a curated ticker returns its company name, segment, and default active listing status.
async function testBuildStockInfoReturnsCuratedProfile(): Promise<void> {
    const stockInfo = await buildStockInfo('aapl')

    assert.equal(stockInfo.stockCode, 'AAPL')
    assert.equal(stockInfo.companyName, 'Apple')
    assert.equal(stockInfo.segment, 'Consumer Technology')
    assert.equal(stockInfo.listingStatus, 'Active public company')
    assert.equal(stockInfo.dataNote, null)
}

// Verify a synthetic/delisted ticker carries the extra data note so the simulator context is explicit.
async function testBuildStockInfoReturnsSyntheticNote(): Promise<void> {
    const stockInfo = await buildStockInfo('WBA')

    assert.equal(stockInfo.stockCode, 'WBA')
    assert.match(stockInfo.listingStatus, /Private/)
    assert.match(stockInfo.dataNote ?? '', /Synthetic price and EPS estimates/)
}

// Verify an unknown ticker falls back to a clearly labeled placeholder profile instead of crashing.
async function testBuildStockInfoFallsBackWhenUncurated(): Promise<void> {
    const stockInfo = await buildStockInfo('ZZZZ')

    assert.equal(stockInfo.stockCode, 'ZZZZ')
    assert.equal(stockInfo.segment, 'Unclassified')
    assert.match(stockInfo.summary, /No curated profile/)
}

// Verify the formatted CLI block includes the key profile fields in a stable human-readable layout.
async function testFormatStockInfo(): Promise<void> {
    const output = formatStockInfo(await buildStockInfo('AAPL'))

    assert.match(output, /AAPL info:/)
    assert.match(output, /company: Apple/)
    assert.match(output, /segment: Consumer Technology/)
}

// Run the focused stock-info tests that protect profile lookup and CLI formatting.
export async function runStockInfoActionTests(): Promise<void> {
    await testBuildStockInfoReturnsCuratedProfile()
    await testBuildStockInfoReturnsSyntheticNote()
    await testBuildStockInfoFallsBackWhenUncurated()
    await testFormatStockInfo()
}

