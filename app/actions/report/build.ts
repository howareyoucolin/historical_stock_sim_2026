import fs from 'node:fs/promises'
import path from 'node:path'

import { buildValuesSummary, type ValuesSummary } from '../account/values-summary'
import { fetchDefaultUserAccountSessionView } from '../account/show'
import { readDefaultUserAccountMeta, USER_SESSIONS_DIRECTORY_NAME, type AccountMeta } from '../account/model'
import type { AccountStockTableRow, DefaultUserAccountSessionView } from '../account/view-model'
import { readHistoryLogEntries } from '../history/log'
import { fetchBenchmark, type StockDataPayload } from '../stock/market-data-client'
import { getActiveSession, reportFileName } from '../session'
import { buildTaxReport } from '../../components/AccountPanel/Content/Summary/TaxReport/taxReport'

interface ParsedHistoryEntry {
    timestamp: string
    action: string
    fields: Record<string, string>
}

interface InvestorCashFlow {
    date: string
    amount: number
}

export interface ReportBuildOptions {
    outputPath?: string
    objectiveTitle?: string
    objectivePrimaryMetric?: string
    objectiveConstraints?: string[]
    strategyName?: string
    strategyVersion?: string
    strategySummary?: string
    thesisSummary?: string
    marketRegime?: string
    volatilityLevel?: string
    note?: string
}

type ReportPositionRow = Omit<AccountStockTableRow, 'lots'>

export interface SimulationReport {
    reportVersion: number
    sessionId: string
    objective: {
        title: string
        primaryMetric: string
        constraints: string[]
    }
    strategy: {
        name: string
        version: string
        summary: string
    }
    thesis: {
        summary: string
        beliefs: Array<{
            topic: string
            view: 'bullish' | 'bearish' | 'neutral'
            confidence: number
            horizon?: string
            reason?: string
        }>
    }
    simulation: {
        simStartDate: string | null
        simEndDate: string
        startedAt: string | null
        finishedAt: string
        startingValue: number | null
        endingCash: number
        endingValue: number
        totalReturnPct: number | null
        annualizedReturnPct: number | null
    }
    activity: {
        historyEventCount: number
        buyCount: number
        sellCount: number
        dividendCount: number
        interestCount: number
        corporateActionCount: number
        uniqueStocksTraded: number
    }
    portfolioSummary: {
        principal: number
        currentTotal: number
        totalGainLoss: number
        totalReturnPct: number | null
        annualizedReturnPct: number | null
        unrealizedGainLoss: number
        unrealizedGainLossPct: number | null
    }
    benchmark: {
        stockCode: string
        endingValue: number | null
        annualizedReturnPct: number | null
        methodology: string
    }
    portfolio: {
        openPositionCount: number
        cashPct: number
        largestPositionPct: number
        maxDrawdownPct: number | null
    }
    positions: {
        asOfDate: string
        rows: ReportPositionRow[]
    }
    taxes: {
        longTermGain: number
        shortTermGain: number
        dividendGain: number
        interestGain: number
        longTermTax: number
        shortTermTax: number
        dividendTax: number
        interestTax: number
        estimatedTax: number
    }
    takeaways: {
        summary: string
        worked: AssessmentItem[]
        didNotWork: AssessmentItem[]
        nextChanges: AssessmentItem[]
    }
    agentLearning: {
        reuseScore: number
        improvementPotentialScore: number
        confidenceScore: number
        tags: string[]
    }
    context: {
        marketRegime: string
        volatilityLevel: string
    }
    note: string
}

export interface AssessmentItem {
    text: string
    score: number
}

export interface BuildSimulationReportResult {
    outputPath: string
    report: SimulationReport
}

export interface BuildSimulationReportDependencies {
    cwd?: () => string
    now?: () => Date
    fetchAccountView?: typeof fetchDefaultUserAccountSessionView
    fetchValuesSummary?: typeof buildValuesSummary
    readHistoryEntries?: typeof readHistoryLogEntries
    readAccountMeta?: typeof readDefaultUserAccountMeta
    getBenchmark?: () => Promise<StockDataPayload | null>
    writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
}

function normalizeText(value: string | undefined, fallback: string): string {
    const trimmed = value?.trim()

    return trimmed && trimmed.length > 0 ? trimmed : fallback
}

function clampScore(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(2))))
}

function parseHistoryEntry(line: string): ParsedHistoryEntry {
    const noteMarker = ' note='
    const markerIndex = line.indexOf(noteMarker)
    const head = markerIndex === -1 ? line : line.slice(0, markerIndex)
    const [timestamp = '', action = '', ...rest] = head.split(' ')
    const fields: Record<string, string> = {}

    for (const token of rest) {
        const separatorIndex = token.indexOf('=')

        if (separatorIndex !== -1) {
            fields[token.slice(0, separatorIndex)] = token.slice(separatorIndex + 1)
        }
    }

    return { timestamp, action, fields }
}

function deriveSimulationStartDate(valuesSummary: ValuesSummary, historyEntries: ParsedHistoryEntry[], accountDate: string): string | null {
    const firstMeaningfulSnapshot = valuesSummary.snapshots.find((snapshot) => snapshot.value > 0)

    if (firstMeaningfulSnapshot) {
        return firstMeaningfulSnapshot.date
    }

    const firstSimDate = historyEntries[0]?.fields.sim

    return firstSimDate ?? accountDate ?? null
}

function deriveStartingValue(valuesSummary: ValuesSummary): number | null {
    const firstMeaningfulSnapshot = valuesSummary.snapshots.find((snapshot) => snapshot.value > 0)

    return firstMeaningfulSnapshot ? Number(firstMeaningfulSnapshot.value.toFixed(2)) : null
}

function buildInvestorCashFlows(historyEntries: ParsedHistoryEntry[]): InvestorCashFlow[] {
    return historyEntries
        .filter((entry) => entry.action === 'DEPOSIT' && entry.fields.sim)
        .map((entry) => ({
            date: entry.fields.sim,
            amount: Number((-parseSignedAmount(entry.fields.cash)).toFixed(2)),
        }))
        .filter((cashFlow) => cashFlow.amount !== 0)
        .sort((left, right) => left.date.localeCompare(right.date))
}

function calculateXnpv(rate: number, cashFlows: InvestorCashFlow[]): number {
    const firstDate = cashFlows[0]?.date

    if (!firstDate) {
        return 0
    }

    const firstTime = new Date(`${firstDate}T00:00:00.000Z`).getTime()

    return cashFlows.reduce((total, cashFlow) => {
        const cashFlowTime = new Date(`${cashFlow.date}T00:00:00.000Z`).getTime()
        const yearFraction = (cashFlowTime - firstTime) / (365.25 * 24 * 60 * 60 * 1000)

        return total + cashFlow.amount / Math.pow(1 + rate, yearFraction)
    }, 0)
}

function calculateAnnualizedReturnPct(cashFlows: InvestorCashFlow[], endingValue: number, endDate: string): number | null {
    const fullCashFlows = [...cashFlows, { date: endDate, amount: Number(endingValue.toFixed(2)) }]

    if (fullCashFlows.length < 2 || endingValue <= 0) {
        return null
    }

    const hasPositive = fullCashFlows.some((cashFlow) => cashFlow.amount > 0)
    const hasNegative = fullCashFlows.some((cashFlow) => cashFlow.amount < 0)

    if (!hasPositive || !hasNegative) {
        return null
    }

    let low = -0.9999
    let high = 0.1
    let lowValue = calculateXnpv(low, fullCashFlows)
    let highValue = calculateXnpv(high, fullCashFlows)

    while (lowValue * highValue > 0 && high < 100) {
        high *= 2
        highValue = calculateXnpv(high, fullCashFlows)
    }

    if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
        return null
    }

    for (let iteration = 0; iteration < 200; iteration += 1) {
        const mid = (low + high) / 2
        const midValue = calculateXnpv(mid, fullCashFlows)

        if (!Number.isFinite(midValue)) {
            return null
        }

        if (Math.abs(midValue) < 1e-7) {
            return Number((mid * 100).toFixed(2))
        }

        if (lowValue * midValue <= 0) {
            high = mid
            highValue = midValue
        } else {
            low = mid
            lowValue = midValue
        }
    }

    return Number((((low + high) / 2) * 100).toFixed(2))
}


function calculateBenchmarkEndingValue(
    benchmarkData: StockDataPayload | null,
    cashFlows: InvestorCashFlow[],
    endDate: string
): number | null {
    if (!benchmarkData || cashFlows.length === 0) {
        return null
    }

    const tradingDates = Object.keys(benchmarkData.historyByDate).filter((date) => date <= endDate).sort()
    const endingEntry = benchmarkData.historyByDate[endDate]

    if (tradingDates.length === 0 || !endingEntry?.close) {
        return null
    }

    const depositsByDate = new Map<string, number>()
    for (const cashFlow of cashFlows) {
        depositsByDate.set(cashFlow.date, (depositsByDate.get(cashFlow.date) ?? 0) + Math.abs(cashFlow.amount))
    }

    let shares = 0

    for (const tradingDate of tradingDates) {
        const entry = benchmarkData.historyByDate[tradingDate]

        if (!entry?.close) {
            continue
        }

        if (entry.isPayoutDate && entry.dividendPerShare > 0 && shares > 0) {
            const dividendCash = shares * entry.dividendPerShare
            shares += dividendCash / entry.close
        }

        const depositAmount = depositsByDate.get(tradingDate) ?? 0

        if (depositAmount > 0) {
            shares += depositAmount / entry.close
        }
    }

    return Number((shares * endingEntry.close).toFixed(2))
}

function deriveStartedAt(historyEntries: ParsedHistoryEntry[], meta: AccountMeta | null): string | null {
    if (historyEntries.length > 0) {
        return historyEntries[0].timestamp
    }

    return meta?.updated_at ?? null
}

function buildActivitySummary(historyEntries: ParsedHistoryEntry[]) {
    const uniqueStocks = new Set<string>()
    let buyCount = 0
    let sellCount = 0
    let dividendCount = 0
    let interestCount = 0
    let corporateActionCount = 0

    for (const entry of historyEntries) {
        if (entry.fields.stock) {
            uniqueStocks.add(entry.fields.stock)
        }

        switch (entry.action) {
            case 'BUY':
                buyCount += 1
                break
            case 'SELL':
                sellCount += 1
                break
            case 'DIVIDEND':
                dividendCount += 1
                break
            case 'INTEREST':
                interestCount += 1
                break
            case 'CORPORATE_ACTION':
                corporateActionCount += 1
                break
            default:
                break
        }
    }

    return {
        historyEventCount: historyEntries.length,
        buyCount,
        sellCount,
        dividendCount,
        interestCount,
        corporateActionCount,
        uniqueStocksTraded: uniqueStocks.size,
    }
}

function buildActivityByStock(historyEntries: ParsedHistoryEntry[]): Record<string, { buys: number; sells: number; dividends: number }> {
    const activityByStock: Record<string, { buys: number; sells: number; dividends: number }> = {}

    for (const entry of historyEntries) {
        const stockCode = entry.fields.stock

        if (!stockCode) {
            continue
        }

        if (!activityByStock[stockCode]) {
            activityByStock[stockCode] = { buys: 0, sells: 0, dividends: 0 }
        }

        if (entry.action === 'BUY') {
            activityByStock[stockCode].buys += 1
        } else if (entry.action === 'SELL') {
            activityByStock[stockCode].sells += 1
        } else if (entry.action === 'DIVIDEND') {
            activityByStock[stockCode].dividends += 1
        }
    }

    return activityByStock
}

function parseSignedAmount(value: string | undefined): number {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : 0
}

function calculatePrincipal(historyEntries: ParsedHistoryEntry[]): number {
    let principal = 0

    for (const entry of historyEntries) {
        if (entry.action === 'DEPOSIT') {
            principal += parseSignedAmount(entry.fields.cash)
        }
    }

    return Number(principal.toFixed(2))
}

function calculateMaxDrawdown(valuesSummary: ValuesSummary): number | null {
    if (valuesSummary.snapshots.length === 0) {
        return null
    }

    let peak = valuesSummary.snapshots[0].value
    let maxDrawdown = 0

    for (const snapshot of valuesSummary.snapshots) {
        if (snapshot.value > peak) {
            peak = snapshot.value
        }

        if (peak > 0) {
            const drawdown = ((snapshot.value - peak) / peak) * 100

            if (drawdown < maxDrawdown) {
                maxDrawdown = drawdown
            }
        }
    }

    return Number(maxDrawdown.toFixed(2))
}

function buildTakeaways(
    totalReturnPct: number | null,
    maxDrawdownPct: number | null,
    largestPositionPct: number,
    cashPct: number,
    activity: SimulationReport['activity']
): SimulationReport['takeaways'] {
    const worked: AssessmentItem[] = []
    const didNotWork: AssessmentItem[] = []

    const summary = totalReturnPct === null
        ? 'The simulation finished without enough value history to calculate a total return.'
        : totalReturnPct >= 0
            ? `The simulation finished up ${totalReturnPct.toFixed(2)}% versus contributed principal.`
            : `The simulation finished down ${Math.abs(totalReturnPct).toFixed(2)}% versus contributed principal.`

    worked.push({
        text: `The strategy followed the trading-universe rule: ${activity.uniqueStocksTraded} user-selected stocks were traded, with ${activity.buyCount} buys and ${activity.sellCount} sells.`,
        score: 1,
    })

    if (totalReturnPct !== null) {
        worked.push({
            text: totalReturnPct >= 0
                ? `The strategy met the capital-growth goal in absolute terms, finishing with a ${totalReturnPct.toFixed(2)}% return on contributed principal.`
                : `The strategy did not meet the capital-growth goal in absolute terms, finishing with a ${Math.abs(totalReturnPct).toFixed(2)}% loss on contributed principal.`,
            score: totalReturnPct >= 0 ? 1 : clampScore(Math.abs(totalReturnPct) / 100),
        })
    }

    if (activity.sellCount === 0) {
        worked.push({ text: 'The strategy followed the no-sell rule for the full run.', score: 1 })
    }

    if (largestPositionPct > 20) {
        didNotWork.push({
            text: `The portfolio did not fully satisfy the anti-concentration goal: the largest ending position reached ${largestPositionPct.toFixed(2)}% of the portfolio.`,
            score: clampScore((largestPositionPct - 15) / 20),
        })
    }

    if (maxDrawdownPct !== null) {
        didNotWork.push({
            text: `The path was volatile: maximum drawdown reached ${maxDrawdownPct.toFixed(2)}%.`,
            score: clampScore(Math.abs(maxDrawdownPct) / 50),
        })
    }

    if (cashPct > 5) {
        didNotWork.push({
            text: `Cash usage drifted higher than intended at the end of the run, finishing at ${cashPct.toFixed(2)}% of the portfolio.`,
            score: clampScore(cashPct / 25),
        })
    }

    return { summary, worked, didNotWork, nextChanges: [] }
}

function looksProceduralNote(note: string): boolean {
    const normalized = note.trim().toLowerCase()

    if (normalized.length === 0) {
        return true
    }

    return [
        'rebuilt report',
        'built report',
        'for review',
        'last available market-data date',
        'dataset did not include',
        'final report uses',
    ].some((pattern) => normalized.includes(pattern))
}

function buildObservationNote(
    totalReturnPct: number | null,
    largestPositionPct: number,
    maxDrawdownPct: number | null,
    largestStockCode: string | null
): string {
    if (largestStockCode && largestPositionPct > 20) {
        return `The ending portfolio drifted away from the original diversification intent: ${largestStockCode} finished as the largest holding at ${largestPositionPct.toFixed(2)}% of the portfolio.`
    }

    if (maxDrawdownPct !== null && maxDrawdownPct <= -20) {
        return `The strategy finished profitable overall, but the path included a deep drawdown of ${maxDrawdownPct.toFixed(2)}%, showing that long-run gains came with substantial interim volatility.`
    }

    if (totalReturnPct !== null) {
        return totalReturnPct >= 0
            ? `The strategy finished with a positive return of ${totalReturnPct.toFixed(2)}% while staying within the user-selected stock universe and no-sell rule.`
            : `The strategy finished with a negative return of ${Math.abs(totalReturnPct).toFixed(2)}% despite staying within the user-selected stock universe and no-sell rule.`
    }

    return ''
}

function buildAgentLearning(
    totalReturnPct: number | null,
    maxDrawdownPct: number | null,
    largestPositionPct: number,
    cashPct: number,
    valuesSummary: ValuesSummary,
    historyCount: number,
    context: SimulationReport['context']
): SimulationReport['agentLearning'] {
    const returnScore = totalReturnPct === null ? 0.35 : clampScore((totalReturnPct + 20) / 80)
    const drawdownPenalty = maxDrawdownPct === null ? 0.1 : clampScore(Math.abs(Math.min(maxDrawdownPct, 0)) / 40)
    const concentrationPenalty = clampScore(Math.max(0, largestPositionPct - 20) / 25)
    const cashPenalty = clampScore(Math.max(0, cashPct - 15) / 35)
    const reuseScore = clampScore(0.25 + returnScore * 0.55 - drawdownPenalty * 0.15 - concentrationPenalty * 0.1 - cashPenalty * 0.05)
    const improvementPotentialScore = clampScore(0.25 + drawdownPenalty * 0.35 + concentrationPenalty * 0.2 + cashPenalty * 0.1 + (totalReturnPct !== null && totalReturnPct <= 0 ? 0.15 : 0))
    const confidenceScore = clampScore(0.3 + Math.min(valuesSummary.count / 120, 0.35) + Math.min(historyCount / 40, 0.2) + (totalReturnPct !== null ? 0.1 : 0))
    const tags = [context.marketRegime, context.volatilityLevel]

    if (largestPositionPct > 25) {
        tags.push('concentrated')
    }

    if (totalReturnPct !== null && totalReturnPct > 0) {
        tags.push('profitable')
    } else if (totalReturnPct !== null && totalReturnPct < 0) {
        tags.push('loss-making')
    }

    return {
        reuseScore,
        improvementPotentialScore,
        confidenceScore,
        tags,
    }
}

// Build and persist a compact simulation report JSON for the active session.
export async function buildSimulationReport(
    options: ReportBuildOptions = {},
    {
        cwd = process.cwd,
        now = () => new Date(),
        fetchAccountView = fetchDefaultUserAccountSessionView,
        fetchValuesSummary = buildValuesSummary,
        readHistoryEntries = readHistoryLogEntries,
        readAccountMeta = readDefaultUserAccountMeta,
        getBenchmark = fetchBenchmark,
        writeFile = fs.writeFile,
        makeDirectory = fs.mkdir,
    }: BuildSimulationReportDependencies = {}
): Promise<BuildSimulationReportResult> {
    const [view, valuesSummary, historyLines, meta] = await Promise.all([
        fetchAccountView(),
        fetchValuesSummary(),
        readHistoryEntries(),
        readAccountMeta(),
    ])
    const historyEntries = historyLines.map(parseHistoryEntry)
    const activity = buildActivitySummary(historyEntries)
    const principal = calculatePrincipal(historyEntries)
    const largestPositionPct = view.rows.reduce((max, row) => Math.max(max, row.percentOfGroup), 0)
    const largestPosition = view.rows.reduce<DefaultUserAccountSessionView['rows'][number] | null>(
        (largest, row) => (largest === null || row.percentOfGroup > largest.percentOfGroup ? row : largest),
        null
    )
    const endingValue = view.account.cash + view.summary.totalCurrentValue
    const totalGainLoss = Number((endingValue - principal).toFixed(2))
    const totalReturnPct = principal === 0 ? null : Number((((endingValue - principal) / principal) * 100).toFixed(2))
    const cashPct = endingValue === 0 ? 0 : (view.account.cash / endingValue) * 100
    const maxDrawdownPct = calculateMaxDrawdown(valuesSummary)
    const simStartDate = deriveSimulationStartDate(valuesSummary, historyEntries, view.account.date)
    const startingValue = deriveStartingValue(valuesSummary)
    const investorCashFlows = buildInvestorCashFlows(historyEntries)
    const annualizedReturnPct = calculateAnnualizedReturnPct(investorCashFlows, endingValue, view.account.date)
    const benchmarkData = await getBenchmark()
    const benchmarkEndingValue = calculateBenchmarkEndingValue(benchmarkData, investorCashFlows, view.account.date)
    const benchmarkAnnualizedReturnPct = benchmarkEndingValue === null
        ? null
        : calculateAnnualizedReturnPct(investorCashFlows, benchmarkEndingValue, view.account.date)
    const finishedAt = now().toISOString()
    const sessionId = getActiveSession() ?? 'default'
    const outputPath = options.outputPath?.trim() || path.join(USER_SESSIONS_DIRECTORY_NAME, reportFileName())
    const generatedNote = buildObservationNote(totalReturnPct, largestPositionPct, maxDrawdownPct, largestPosition?.stockCode ?? null)
    const normalizedNote = options.note?.trim() ?? ''
    const taxSummary = buildTaxReport(historyLines).total
    const report: SimulationReport = {
        reportVersion: 1,
        sessionId,
        objective: {
            title: normalizeText(options.objectiveTitle, 'Unspecified objective'),
            primaryMetric: normalizeText(options.objectivePrimaryMetric, 'totalReturnPct'),
            constraints: (options.objectiveConstraints ?? []).map((constraint) => constraint.trim()).filter((constraint) => constraint.length > 0),
        },
        strategy: {
            name: normalizeText(options.strategyName, 'Unspecified strategy'),
            version: normalizeText(options.strategyVersion, 'v1'),
            summary: normalizeText(options.strategySummary, 'No strategy summary was provided.'),
        },
        thesis: {
            summary: normalizeText(options.thesisSummary, 'No forward-looking thesis was provided.'),
            beliefs: [],
        },
        simulation: {
            simStartDate,
            simEndDate: view.account.date,
            startedAt: deriveStartedAt(historyEntries, meta),
            finishedAt,
            startingValue,
            endingCash: Number(view.account.cash.toFixed(2)),
            endingValue: Number(endingValue.toFixed(2)),
            totalReturnPct,
            annualizedReturnPct,
        },
        activity,
        portfolioSummary: {
            principal,
            currentTotal: Number(endingValue.toFixed(2)),
            totalGainLoss,
            totalReturnPct,
            annualizedReturnPct,
            unrealizedGainLoss: Number(view.summary.totalGainLoss.toFixed(2)),
            unrealizedGainLossPct: Number(view.summary.percentGainLoss.toFixed(2)),
        },
        benchmark: {
            stockCode: 'S&P 500 (EW)',
            endingValue: benchmarkEndingValue,
            annualizedReturnPct: benchmarkAnnualizedReturnPct,
            methodology: 'Same DEPOSIT cash-flow schedule invested into the equal-weight S&P 500 index using its daily index level.',
        },
        portfolio: {
            openPositionCount: view.rows.length,
            cashPct: Number(cashPct.toFixed(2)),
            largestPositionPct: Number(largestPositionPct.toFixed(2)),
            maxDrawdownPct,
        },
        positions: {
            asOfDate: view.account.date,
            rows: view.rows.map(({ lots: _lots, ...row }) => ({ ...row })),
        },
        taxes: {
            longTermGain: Number(taxSummary.longTermGain.toFixed(2)),
            shortTermGain: Number(taxSummary.shortTermGain.toFixed(2)),
            dividendGain: Number(taxSummary.dividendGain.toFixed(2)),
            interestGain: Number(taxSummary.interestGain.toFixed(2)),
            longTermTax: Number(taxSummary.longTermTax.toFixed(2)),
            shortTermTax: Number(taxSummary.shortTermTax.toFixed(2)),
            dividendTax: Number(taxSummary.dividendTax.toFixed(2)),
            interestTax: Number(taxSummary.interestTax.toFixed(2)),
            estimatedTax: Number(taxSummary.estimatedTax.toFixed(2)),
        },
        takeaways: buildTakeaways(totalReturnPct, maxDrawdownPct, largestPositionPct, cashPct, activity),
        agentLearning: buildAgentLearning(
            totalReturnPct,
            maxDrawdownPct,
            largestPositionPct,
            cashPct,
            valuesSummary,
            historyEntries.length,
            {
                marketRegime: normalizeText(options.marketRegime, 'unknown'),
                volatilityLevel: normalizeText(options.volatilityLevel, 'unknown'),
            }
        ),
        context: {
            marketRegime: normalizeText(options.marketRegime, 'unknown'),
            volatilityLevel: normalizeText(options.volatilityLevel, 'unknown'),
        },
        note: looksProceduralNote(normalizedNote) ? generatedNote : normalizedNote,
    }

    const absoluteOutputPath = path.isAbsolute(outputPath) ? outputPath : path.join(cwd(), outputPath)

    await makeDirectory(path.dirname(absoluteOutputPath), { recursive: true })
    await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

    return { outputPath, report }
}
