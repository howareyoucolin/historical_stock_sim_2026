import assert from 'node:assert/strict'

import { readSimulationReport } from './read'

// Verify a saved report JSON is parsed and returned to UI/API consumers.
async function testReadSimulationReport(): Promise<void> {
    const report = await readSimulationReport({
        cwd: () => '/repo',
        readFile: async () =>
            JSON.stringify({
                reportVersion: 1,
                sessionId: 'default',
                objective: { title: 'Compound capital', primaryMetric: 'totalReturnPct', constraints: [] },
                strategy: { name: 'Quality Pullback', version: 'v1', summary: 'Buy strong businesses.' },
                thesis: { summary: 'Technology should outperform the broader market.', beliefs: [] },
                simulation: {
                    simStartDate: '2016-01-04',
                    simEndDate: '2020-12-31',
                    startedAt: '2026-06-20T14:00:00.000Z',
                    finishedAt: '2026-06-20T14:08:12.000Z',
                    startingValue: 100000,
                    endingCash: 12000,
                    endingValue: 164500,
                    totalReturnPct: 64.5,
                    annualizedReturnPct: 10.45,
                },
                activity: {
                    historyEventCount: 12,
                    buyCount: 4,
                    sellCount: 2,
                    dividendCount: 3,
                    interestCount: 1,
                    corporateActionCount: 0,
                    uniqueStocksTraded: 3,
                },
                portfolioSummary: {
                    principal: 100000,
                    currentTotal: 164500,
                    totalGainLoss: 64500,
                    totalReturnPct: 64.5,
                    annualizedReturnPct: 10.45,
                    unrealizedGainLoss: 52500,
                    unrealizedGainLossPct: 46.46,
                },
                benchmark: {
                    stockCode: 'SPY',
                    endingValue: 152000,
                    annualizedReturnPct: 8.22,
                    methodology: 'Same DEPOSIT cash-flow schedule invested into SPY using local close prices with dividends reinvested on payout dates.',
                },
                portfolio: {
                    openPositionCount: 2,
                    cashPct: 7.3,
                    largestPositionPct: 18.4,
                    maxDrawdownPct: -18.2,
                },
                positions: {
                    asOfDate: '2020-12-31',
                    rows: [
                        {
                            stockCode: 'AAPL',
                            averageCost: 85.2,
                            currentPrice: 132.5,
                            priceChange: 1.2,
                            priceChangePercent: 0.91,
                            dayChangeValue: 48,
                            peRatio: 28,
                            quantity: 40,
                            totalCostBasis: 3408,
                            totalValue: 5300,
                            totalGainLoss: 1892,
                            percentGainLoss: 55.52,
                            purchaseDate: '2016-01-04',
                            percentOfGroup: 66.25,
                        },
                    ],
                },
                taxes: {
                    longTermGain: 800,
                    shortTermGain: -200,
                    dividendGain: 110,
                    interestGain: 0,
                    longTermTax: 120,
                    shortTermTax: 0,
                    dividendTax: 16.5,
                    interestTax: 0,
                    estimatedTax: 136.5,
                },
                takeaways: {
                    summary: 'Outperformed.',
                    worked: [{ text: 'The strategy produced a positive overall return.', score: 0.9 }],
                    didNotWork: [{ text: 'Concentration drifted too high.', score: 0.55 }],
                    nextChanges: [{ text: 'Cap single-position exposure earlier.', score: 0.55 }],
                },
                agentLearning: { reuseScore: 0.81, improvementPotentialScore: 0.68, confidenceScore: 0.74, tags: ['bull'] },
                context: { marketRegime: 'bull', volatilityLevel: 'medium' },
                note: 'Focused run.',
            }),
    })

    assert.equal(report?.strategy.name, 'Quality Pullback')
    assert.equal(report?.thesis.summary, 'Technology should outperform the broader market.')
    assert.equal(report?.context.marketRegime, 'bull')
    assert.equal(report?.taxes.estimatedTax, 136.5)
}

// Verify a missing report file yields null so the UI can show a friendly empty state.
async function testReadSimulationReportMissing(): Promise<void> {
    const report = await readSimulationReport({
        cwd: () => '/repo',
        readFile: async () => {
            const error = new Error('missing') as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
        },
    })

    assert.equal(report, null)
}

// Run the focused saved-report read tests.
export async function runReadSimulationReportTests(): Promise<void> {
    await testReadSimulationReport()
    await testReadSimulationReportMissing()
}
