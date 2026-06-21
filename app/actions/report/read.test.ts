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
                },
                portfolio: {
                    openPositionCount: 2,
                    cashPct: 7.3,
                    largestPositionPct: 18.4,
                    maxDrawdownPct: -18.2,
                },
                positions: [],
                takeaways: {
                    summary: 'Outperformed.',
                    worked: [{ text: 'The strategy produced a positive overall return.', score: 0.9 }],
                    didNotWork: [{ text: 'Concentration drifted too high.', score: 0.55 }],
                    nextChanges: [{ text: 'Cap single-position exposure earlier.', score: 0.55 }],
                },
                agentLearning: { reuseScore: 0.81, improvementPotentialScore: 0.68, confidenceScore: 0.74, tags: ['bull'] },
                context: { marketRegime: 'bull', volatilityLevel: 'medium' },
                note: 'Focused run.',
                files: {
                    account: 'user-sessions/account.json',
                    history: 'user-sessions/history.log',
                    values: 'user-sessions/values.log',
                    report: 'user-sessions/report.json',
                },
            }),
    })

    assert.equal(report?.strategy.name, 'Quality Pullback')
    assert.equal(report?.thesis.summary, 'Technology should outperform the broader market.')
    assert.equal(report?.context.marketRegime, 'bull')
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
