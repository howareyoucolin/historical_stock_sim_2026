import fs from 'node:fs/promises'
import path from 'node:path'

import { buildValuesSummary, type ValuesSummary } from '../account/values-summary'
import { fetchDefaultUserAccountSessionView } from '../account/show'
import { readDefaultUserAccountMeta, USER_SESSIONS_DIRECTORY_NAME, type AccountMeta } from '../account/model'
import type { DefaultUserAccountSessionView } from '../account/view-model'
import { readHistoryLogEntries } from '../history/log'
import { getActiveSession, reportFileName } from '../session'

interface ParsedHistoryEntry {
    timestamp: string
    action: string
    fields: Record<string, string>
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
    }
    portfolio: {
        openPositionCount: number
        cashPct: number
        largestPositionPct: number
        maxDrawdownPct: number | null
    }
    positions: Array<{
        bucket: string
        status: 'open'
        sharesHeld: number
        avgCost: number
        lastPrice: number
        marketValue: number
        unrealizedGainLoss: number
        unrealizedGainLossPct: number
        weightPct: number
        activity: {
            buys: number
            sells: number
            dividends: number
        }
    }>
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
    files: {
        account: string
        history: string
        values: string
        report: string
    }
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
    if (valuesSummary.first) {
        return valuesSummary.first.date
    }

    const firstSimDate = historyEntries[0]?.fields.sim

    return firstSimDate ?? accountDate ?? null
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

function buildPositionSummaries(
    view: DefaultUserAccountSessionView,
    activityByStock: Record<string, { buys: number; sells: number; dividends: number }>
): SimulationReport['positions'] {
    return [...view.rows]
        .sort((left, right) => right.totalValue - left.totalValue)
        .map((row, index) => ({
            bucket: `position_${index + 1}`,
            status: 'open',
            sharesHeld: row.quantity,
            avgCost: Number(row.averageCost.toFixed(2)),
            lastPrice: Number(row.currentPrice.toFixed(2)),
            marketValue: Number(row.totalValue.toFixed(2)),
            unrealizedGainLoss: Number(row.totalGainLoss.toFixed(2)),
            unrealizedGainLossPct: Number(row.percentGainLoss.toFixed(2)),
            weightPct: Number(row.percentOfGroup.toFixed(2)),
            activity: activityByStock[row.stockCode] ?? { buys: 0, sells: 0, dividends: 0 },
        }))
}

function buildTakeaways(
    totalReturnPct: number | null,
    maxDrawdownPct: number | null,
    largestPositionPct: number,
    cashPct: number
): SimulationReport['takeaways'] {
    const worked: AssessmentItem[] = []
    const didNotWork: AssessmentItem[] = []
    const nextChanges: AssessmentItem[] = []

    const summary = totalReturnPct === null
        ? 'The simulation finished without enough value history to calculate a total return.'
        : totalReturnPct >= 0
            ? `The simulation finished up ${totalReturnPct.toFixed(2)}% versus contributed principal.`
            : `The simulation finished down ${Math.abs(totalReturnPct).toFixed(2)}% versus contributed principal.`

    if (totalReturnPct !== null && totalReturnPct > 0) {
        worked.push({ text: 'The strategy produced a positive overall return.', score: clampScore(totalReturnPct / 40) })
    }

    if (maxDrawdownPct !== null && maxDrawdownPct > -15) {
        worked.push({ text: 'Drawdowns stayed fairly contained during the run.', score: clampScore(1 - Math.abs(maxDrawdownPct) / 20) })
    }

    if (largestPositionPct <= 20) {
        worked.push({ text: 'Position sizing stayed reasonably balanced.', score: clampScore(1 - largestPositionPct / 30) })
    }

    if (maxDrawdownPct !== null && maxDrawdownPct <= -20) {
        didNotWork.push({ text: 'Drawdowns were significant and exposed weak risk controls.', score: clampScore(Math.abs(maxDrawdownPct) / 60) })
        nextChanges.push({ text: 'Add tighter drawdown or stop-loss rules.', score: clampScore(Math.abs(maxDrawdownPct) / 60) })
    }

    if (largestPositionPct > 25) {
        didNotWork.push({ text: 'One position became too large and increased concentration risk.', score: clampScore((largestPositionPct - 20) / 40) })
        nextChanges.push({ text: 'Cap single-position exposure earlier in the run.', score: clampScore((largestPositionPct - 20) / 40) })
    }

    if (cashPct > 25) {
        didNotWork.push({ text: 'A large cash balance sat idle for much of the portfolio.', score: clampScore((cashPct - 20) / 40) })
        nextChanges.push({ text: 'Define clearer deployment rules for excess cash.', score: clampScore((cashPct - 20) / 40) })
    }

    if (totalReturnPct !== null && totalReturnPct <= 0) {
        nextChanges.push({ text: 'Review entry and exit rules before re-running the same strategy.', score: clampScore(Math.abs(totalReturnPct) / 50) })
    }

    if (worked.length === 0) {
        const fallbackScore =
            cashPct <= 20
                ? clampScore(0.45)
                : clampScore(0.3)

        worked.push({
            text: cashPct <= 20
                ? 'Cash usage stayed reasonably disciplined even though the overall run struggled.'
                : 'The run still produced usable evidence about where the strategy broke down.',
            score: fallbackScore,
        })
    }

    return { summary, worked, didNotWork, nextChanges }
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
    const activityByStock = buildActivityByStock(historyEntries)
    const principal = calculatePrincipal(historyEntries)
    const largestPositionPct = view.rows.reduce((max, row) => Math.max(max, row.percentOfGroup), 0)
    const endingValue = view.account.cash + view.summary.totalCurrentValue
    const totalGainLoss = Number((endingValue - principal).toFixed(2))
    const totalReturnPct = principal === 0 ? null : Number((((endingValue - principal) / principal) * 100).toFixed(2))
    const cashPct = endingValue === 0 ? 0 : (view.account.cash / endingValue) * 100
    const maxDrawdownPct = calculateMaxDrawdown(valuesSummary)
    const finishedAt = now().toISOString()
    const sessionId = getActiveSession() ?? 'default'
    const outputPath = options.outputPath?.trim() || path.join(USER_SESSIONS_DIRECTORY_NAME, reportFileName())
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
            simStartDate: deriveSimulationStartDate(valuesSummary, historyEntries, view.account.date),
            simEndDate: view.account.date,
            startedAt: deriveStartedAt(historyEntries, meta),
            finishedAt,
            startingValue: valuesSummary.first ? Number(valuesSummary.first.value.toFixed(2)) : null,
            endingCash: Number(view.account.cash.toFixed(2)),
            endingValue: Number(endingValue.toFixed(2)),
            totalReturnPct,
        },
        activity,
        portfolioSummary: {
            principal,
            currentTotal: Number(endingValue.toFixed(2)),
            totalGainLoss,
            totalReturnPct,
        },
        portfolio: {
            openPositionCount: view.rows.length,
            cashPct: Number(cashPct.toFixed(2)),
            largestPositionPct: Number(largestPositionPct.toFixed(2)),
            maxDrawdownPct,
        },
        positions: buildPositionSummaries(view, activityByStock),
        takeaways: buildTakeaways(totalReturnPct, maxDrawdownPct, largestPositionPct, cashPct),
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
        note: options.note?.trim() ?? '',
        files: {
            account: `${USER_SESSIONS_DIRECTORY_NAME}/${sessionId === 'default' ? 'account.json' : `${sessionId}.account.json`}`,
            history: `${USER_SESSIONS_DIRECTORY_NAME}/${sessionId === 'default' ? 'history.log' : `${sessionId}.history.log`}`,
            values: `${USER_SESSIONS_DIRECTORY_NAME}/${sessionId === 'default' ? 'values.log' : `${sessionId}.values.log`}`,
            report: outputPath,
        },
    }

    const absoluteOutputPath = path.isAbsolute(outputPath) ? outputPath : path.join(cwd(), outputPath)

    await makeDirectory(path.dirname(absoluteOutputPath), { recursive: true })
    await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

    return { outputPath, report }
}
