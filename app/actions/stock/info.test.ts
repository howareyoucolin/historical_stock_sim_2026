import assert from 'node:assert/strict'

import { buildStockInfo, formatStockInfo, type StockInfoFetcher } from './info'

// A fake DB profile fetcher so tests never hit the network.
const fakeInfo: StockInfoFetcher = async (code) =>
    code === 'AAPL'
        ? { stockCode: 'AAPL', companyName: 'Apple Inc.', sector: 'Information Technology', industry: 'Technology Hardware, Storage & Peripherals', description: 'Consumer tech platforms and devices.' }
        : null

// Verify a known ticker maps the DB profile into the stock-info shape (segment == DB sector).
async function testBuildStockInfoMapsDbProfile(): Promise<void> {
    const stockInfo = await buildStockInfo('aapl', { getStockInfo: fakeInfo })

    assert.equal(stockInfo.stockCode, 'AAPL')
    assert.equal(stockInfo.companyName, 'Apple Inc.')
    assert.equal(stockInfo.segment, 'Information Technology')
    assert.equal(stockInfo.industry, 'Technology Hardware, Storage & Peripherals')
    assert.equal(stockInfo.summary, 'Consumer tech platforms and devices.')
}

// Verify an unknown ticker falls back to a clearly labeled placeholder instead of crashing.
async function testBuildStockInfoFallsBackWhenUnknown(): Promise<void> {
    const stockInfo = await buildStockInfo('ZZZZ', { getStockInfo: fakeInfo })

    assert.equal(stockInfo.stockCode, 'ZZZZ')
    assert.equal(stockInfo.companyName, 'ZZZZ')
    assert.equal(stockInfo.segment, 'Unclassified')
    assert.equal(stockInfo.industry, 'Unclassified')
}

// Verify the formatted CLI block includes the key profile fields in a stable layout.
async function testFormatStockInfo(): Promise<void> {
    const output = formatStockInfo(await buildStockInfo('AAPL', { getStockInfo: fakeInfo }))

    assert.match(output, /AAPL info:/)
    assert.match(output, /company:  Apple Inc\./)
    assert.match(output, /segment:  Information Technology/)
    assert.match(output, /industry: Technology Hardware/)
}

// Run the focused stock-info tests that protect profile lookup and CLI formatting.
export async function runStockInfoActionTests(): Promise<void> {
    await testBuildStockInfoMapsDbProfile()
    await testBuildStockInfoFallsBackWhenUnknown()
    await testFormatStockInfo()
}
