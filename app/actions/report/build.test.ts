import assert from 'node:assert/strict'

import { buildSimulationReport } from './build'

// Verify report build composes a compact JSON artifact from the current account, values, and history state.
async function testBuildSimulationReport(): Promise<void> {
    let capturedPath = ''
    let capturedContents = ''
    const result = await buildSimulationReport(
        {
            strategyName: 'Quality Pullback Rotation',
            strategyVersion: 'v3',
            strategySummary: 'Buy strong businesses on pullbacks and trim oversized winners.',
            thesisSummary: 'Quality technology businesses should keep compounding faster than the broader market.',
            objectiveTitle: 'Compound capital with moderate risk',
            objectivePrimaryMetric: 'totalReturnPct',
            objectiveConstraints: ['max drawdown under 25%', 'max 10 positions'],
            marketRegime: 'bull',
            volatilityLevel: 'medium',
            note: 'Focused on concentrated quality growth.',
        },
        {
            cwd: () => '/repo',
            now: () => new Date('2026-06-20T14:08:12.000Z'),
            fetchAccountView: async () => ({
                account: { date: '2020-12-31', cash: 12000, positions: {} },
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
                        lots: [],
                    },
                    {
                        stockCode: 'MSFT',
                        averageCost: 72,
                        currentPrice: 110,
                        priceChange: 0.8,
                        priceChangePercent: 0.73,
                        dayChangeValue: 20,
                        peRatio: 31,
                        quantity: 20,
                        totalCostBasis: 1440,
                        totalValue: 2200,
                        totalGainLoss: 760,
                        percentGainLoss: 52.78,
                        purchaseDate: '2017-03-10',
                        percentOfGroup: 27.5,
                        lots: [],
                    },
                ],
                summary: {
                    principal: 4848,
                    totalCurrentValue: 7500,
                    totalGainLoss: 2652,
                    percentGainLoss: 54.7,
                    totalDayChange: 68,
                    dayChangePercent: 0.63,
                },
            }),
            fetchValuesSummary: async () => ({
                snapshots: [
                    { date: '2016-01-04', value: 100000 },
                    { date: '2018-01-02', value: 95000 },
                    { date: '2020-12-31', value: 164500 },
                ],
                count: 3,
                first: { date: '2016-01-04', value: 100000 },
                last: { date: '2020-12-31', value: 164500 },
                change: 64500,
                changePercent: 64.5,
                high: { date: '2020-12-31', value: 164500 },
                low: { date: '2018-01-02', value: 95000 },
            }),
            readHistoryEntries: async () => [
                '2026-06-20T14:00:00.000Z DEPOSIT cash=+100000.00 sim=2016-01-04',
                '2026-06-20T14:01:00.000Z BUY stock=AAPL qty=40 price=85.20 cash=-3408.00 sim=2016-01-04',
                '2026-06-20T14:02:00.000Z BUY stock=MSFT qty=20 price=72.00 cash=-1440.00 sim=2017-03-10',
                '2026-06-20T14:02:30.000Z SELL stock=MSFT qty=20 price=80.00 acquired=2017-03-10 term=SHORT cash=+1600.00 sim=2017-12-01',
                '2026-06-20T14:03:00.000Z DIVIDEND stock=AAPL qty=40 price=0.50 cash=+20.00 sim=2018-01-15',
                '2026-06-20T14:04:00.000Z INTEREST cash=+12.00 sim=2018-02-01',
            ],
            readAccountMeta: async () => ({ date: '2020-12-31', updated_at: '2026-06-20T14:05:00.000Z' }),
            readMarketDataFile: async () =>
                JSON.stringify({
                    stockCode: 'SPY',
                    historyByDate: {
                        '2016-01-04': { close: 100, isPayoutDate: false, dividendPerShare: 0, ttmEps: null, peRatio: null, sharesOutstanding: null, marketCap: null },
                        '2020-12-31': { close: 200, isPayoutDate: false, dividendPerShare: 0, ttmEps: null, peRatio: null, sharesOutstanding: null, marketCap: null },
                    },
                }),
            makeDirectory: async () => undefined,
            writeFile: async (filePath, data) => {
                capturedPath = filePath
                capturedContents = data
            },
        }
    )

    assert.equal(result.outputPath, 'user-sessions/report.json')
    assert.equal(capturedPath, '/repo/user-sessions/report.json')
    assert.match(capturedContents, /"sessionId": "default"/)
    assert.equal(result.report.strategy.name, 'Quality Pullback Rotation')
    assert.equal(result.report.thesis.summary, 'Quality technology businesses should keep compounding faster than the broader market.')
    assert.equal(result.report.objective.title, 'Compound capital with moderate risk')
    assert.equal(result.report.context.marketRegime, 'bull')
    assert.equal(result.report.context.volatilityLevel, 'medium')
    assert.equal(result.report.simulation.startedAt, '2026-06-20T14:00:00.000Z')
    assert.equal(result.report.simulation.finishedAt, '2026-06-20T14:08:12.000Z')
    assert.equal(result.report.simulation.totalReturnPct, -80.5)
    assert.equal(result.report.simulation.annualizedReturnPct, -27.93)
    assert.equal(result.report.activity.buyCount, 2)
    assert.equal(result.report.activity.dividendCount, 1)
    assert.equal(result.report.activity.interestCount, 1)
    assert.equal(result.report.portfolioSummary.principal, 100000)
    assert.equal(result.report.portfolioSummary.currentTotal, 19500)
    assert.equal(result.report.portfolioSummary.totalGainLoss, -80500)
    assert.equal(result.report.portfolioSummary.totalReturnPct, -80.5)
    assert.equal(result.report.portfolioSummary.annualizedReturnPct, -27.93)
    assert.equal(result.report.portfolioSummary.unrealizedGainLoss, 2652)
    assert.equal(result.report.portfolioSummary.unrealizedGainLossPct, 54.7)
    assert.equal(result.report.benchmark.stockCode, 'SPY')
    assert.equal(result.report.benchmark.endingValue, 200000)
    assert.equal(result.report.taxes.shortTermTax, 38.4)
    assert.equal(result.report.taxes.longTermTax, 0)
    assert.equal(result.report.taxes.dividendTax, 3)
    assert.equal(result.report.taxes.interestTax, 2.88)
    assert.equal(result.report.taxes.estimatedTax, 44.28)
    assert.equal(result.report.portfolio.largestPositionPct, 66.25)
    assert.equal(result.report.portfolio.maxDrawdownPct, -5)
    assert.equal(result.report.takeaways.worked.length > 0, true)
    assert.equal(typeof result.report.takeaways.worked[0].score, 'number')
    assert.equal(typeof result.report.takeaways.didNotWork[0].score, 'number')
    assert.equal(result.report.agentLearning.tags.includes('bull'), true)
    assert.equal(result.report.note, 'Focused on concentrated quality growth.')
}

async function testBuildSimulationReportReplacesProceduralNote(): Promise<void> {
    const result = await buildSimulationReport(
        {
            strategyName: 'Test Strategy',
            note: 'Rebuilt report for review. Final report uses the last available market-data date.',
        },
        {
            cwd: () => '/repo',
            now: () => new Date('2026-06-20T14:08:12.000Z'),
            fetchAccountView: async () => ({
                account: { date: '2020-12-31', cash: 100, positions: {} },
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
                        lots: [],
                    },
                    {
                        stockCode: 'MSFT',
                        averageCost: 72,
                        currentPrice: 110,
                        priceChange: 0.8,
                        priceChangePercent: 0.73,
                        dayChangeValue: 20,
                        peRatio: 31,
                        quantity: 20,
                        totalCostBasis: 1440,
                        totalValue: 2200,
                        totalGainLoss: 760,
                        percentGainLoss: 52.78,
                        purchaseDate: '2017-03-10',
                        percentOfGroup: 27.5,
                        lots: [],
                    },
                ],
                summary: {
                    principal: 4848,
                    totalCurrentValue: 7500,
                    totalGainLoss: 2652,
                    percentGainLoss: 54.7,
                    totalDayChange: 68,
                    dayChangePercent: 0.63,
                },
            }),
            fetchValuesSummary: async () => ({
                snapshots: [
                    { date: '2016-01-04', value: 0 },
                    { date: '2016-01-05', value: 100000 },
                    { date: '2020-12-31', value: 164500 },
                ],
                count: 3,
                first: { date: '2016-01-04', value: 0 },
                last: { date: '2020-12-31', value: 164500 },
                change: 64500,
                changePercent: 64.5,
                high: { date: '2020-12-31', value: 164500 },
                low: { date: '2016-01-04', value: 0 },
            }),
            readHistoryEntries: async () => [
                '2026-06-20T14:00:00.000Z DEPOSIT cash=+100000.00 sim=2016-01-05',
                '2026-06-20T14:01:00.000Z BUY stock=AAPL qty=40 price=85.20 cash=-3408.00 sim=2016-01-05',
                '2026-06-20T14:02:00.000Z BUY stock=MSFT qty=20 price=72.00 cash=-1440.00 sim=2017-03-10',
            ],
            readAccountMeta: async () => ({ date: '2020-12-31', updated_at: '2026-06-20T14:05:00.000Z' }),
            readMarketDataFile: async () =>
                JSON.stringify({
                    stockCode: 'SPY',
                    historyByDate: {
                        '2016-01-05': { close: 100, isPayoutDate: false, dividendPerShare: 0, ttmEps: null, peRatio: null, sharesOutstanding: null, marketCap: null },
                        '2020-12-31': { close: 200, isPayoutDate: false, dividendPerShare: 0, ttmEps: null, peRatio: null, sharesOutstanding: null, marketCap: null },
                    },
                }),
            makeDirectory: async () => undefined,
            writeFile: async () => undefined,
        }
    )

    assert.equal(result.report.simulation.simStartDate, '2016-01-05')
    assert.equal(result.report.simulation.startingValue, 100000)
    assert.match(result.report.note, /AAPL finished as the largest holding/i)
}

// Run the focused simulation-report builder tests.
export async function runBuildSimulationReportTests(): Promise<void> {
    await testBuildSimulationReport()
    await testBuildSimulationReportReplacesProceduralNote()
}
