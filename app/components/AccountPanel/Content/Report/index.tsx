'use client'

import { useEffect } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import type { SimulationReport } from '../../../../actions/report/build'
import { money, percent, signedMoney, signedPercent, tone } from '../../../shared/format'
import { loadReport } from './actions'

// Render one labeled summary row in the report's top ledger.
function SummaryRow({ label, value, detail, valueClass = '' }: { label: string; value: string; detail?: string; valueClass?: string }) {
    return (
        <div className="reportSummaryRow">
            <dt>{label}</dt>
            <dd>
                <strong className={valueClass}>{value}</strong>
                {detail ? <span>{detail}</span> : null}
            </dd>
        </div>
    )
}

// Render the saved simulation report as a flowing memo-style document instead of dashboard cards.
export function Report() {
    const dispatch = useAppDispatch()
    const report = useAppSelector((state) => state.account.report)
    const reportError = useAppSelector((state) => state.account.reportError)

    useEffect(() => {
        void dispatch(loadReport())
    }, [dispatch])

    if (reportError) {
        return <div className="reportEmpty">Could not load the saved report: {reportError}</div>
    }

    if (!report) {
        return <div className="reportEmpty">No report has been built yet. Run `report build` after the simulation reaches its final end date.</div>
    }

    const safeReport = report as Partial<SimulationReport>
    const strategy = safeReport.strategy ?? { name: 'Unnamed strategy', version: '', summary: 'No strategy summary was provided.' }
    const objective = safeReport.objective ?? { title: 'Unspecified objective', primaryMetric: '—', constraints: [] }
    const thesis = safeReport.thesis ?? { summary: 'No forward-looking thesis was provided.', beliefs: [] }
    const simulation = safeReport.simulation ?? {
        simStartDate: null,
        simEndDate: '—',
        startedAt: null,
        finishedAt: null,
        startingValue: null,
        endingCash: 0,
        endingValue: 0,
        totalReturnPct: null,
        annualizedReturnPct: null,
    }
    const activity = safeReport.activity ?? {
        historyEventCount: 0,
        buyCount: 0,
        sellCount: 0,
        dividendCount: 0,
        interestCount: 0,
        corporateActionCount: 0,
        uniqueStocksTraded: 0,
    }
    const portfolioSummary = safeReport.portfolioSummary ?? {
        principal: 0,
        currentTotal: simulation.endingValue ?? 0,
        totalGainLoss: 0,
        totalReturnPct: simulation.totalReturnPct ?? null,
        annualizedReturnPct: simulation.annualizedReturnPct ?? null,
        unrealizedGainLoss: 0,
        unrealizedGainLossPct: null,
    }
    const benchmark = safeReport.benchmark ?? {
        stockCode: 'SPY',
        endingValue: null,
        annualizedReturnPct: null,
        methodology: 'Benchmark data unavailable.',
    }
    const portfolio = safeReport.portfolio ?? {
        openPositionCount: 0,
        cashPct: 0,
        largestPositionPct: 0,
        maxDrawdownPct: null,
    }
    const taxes = safeReport.taxes ?? {
        longTermGain: 0,
        shortTermGain: 0,
        dividendGain: 0,
        interestGain: 0,
        longTermTax: 0,
        shortTermTax: 0,
        dividendTax: 0,
        interestTax: 0,
        estimatedTax: 0,
    }
    const takeaways = safeReport.takeaways ?? {
        summary: 'No written assessment is available for this report yet.',
        worked: [],
        didNotWork: [],
        nextChanges: [],
    }
    const factualFindings = [...(takeaways.worked ?? []), ...(takeaways.didNotWork ?? [])]
    const periodLabel = simulation.simStartDate === null ? simulation.simEndDate : `${simulation.simStartDate} → ${simulation.simEndDate}`

    return (
        <article className="reportDoc">
            <header className="reportDocHeader">
                <span className="reportKicker">Simulation Report</span>
                <h1>{strategy.name}</h1>
                <p className="reportLead">{takeaways.summary}</p>
            </header>

            <section className="reportSection">
                <h2>Thesis</h2>
                <p className="reportBody">{thesis.summary}</p>
            </section>

            <section className="reportSection">
                <h2>Goal</h2>
                <p className="reportBodyStrong">{objective.title}</p>
                <p className="reportMuted">Primary metric: {objective.primaryMetric}</p>
            </section>

            <section className="reportSection">
                <h2>Period</h2>
                <dl className="reportFacts">
                    <div>
                        <dt>Simulation range</dt>
                        <dd>{periodLabel}</dd>
                    </div>
                    <div>
                        <dt>Starting value</dt>
                        <dd>{simulation.startingValue === null ? '—' : money(simulation.startingValue)}</dd>
                    </div>
                    <div>
                        <dt>Principal contributed</dt>
                        <dd>{money(portfolioSummary.principal)}</dd>
                    </div>
                    <div>
                        <dt>Ending cash</dt>
                        <dd>{money(simulation.endingCash)}</dd>
                    </div>
                </dl>
            </section>

            <section className="reportSection">
                <h2>Strategy Rules</h2>
                <p className="reportBodyStrong">{strategy.name} <span className="reportInlineMeta">{strategy.version}</span></p>
                <ul className="reportBullets">
                    {objective.constraints.length === 0 ? <li className="reportEmptyLine">—</li> : objective.constraints.map((item) => <li key={item}>{item}</li>)}
                </ul>
            </section>

            <section className="reportSection">
                <h2>Result</h2>
                <dl className="reportSummaryList">
                    <SummaryRow label="Ending value" value={money(portfolioSummary.currentTotal)} detail="Portfolio value at the final available date" />
                    <SummaryRow
                        label="Total gain/loss"
                        value={signedMoney(portfolioSummary.totalGainLoss)}
                        detail={portfolioSummary.totalReturnPct === null ? '—' : signedPercent(portfolioSummary.totalReturnPct)}
                        valueClass={tone(portfolioSummary.totalGainLoss)}
                    />
                    <SummaryRow
                        label="Avg yearly gain"
                        value={portfolioSummary.annualizedReturnPct === null ? '—' : signedPercent(portfolioSummary.annualizedReturnPct)}
                        detail="Money-weighted annualized return using the recorded deposit schedule"
                        valueClass={tone(portfolioSummary.annualizedReturnPct ?? 0)}
                    />
                    <SummaryRow
                        label={`${benchmark.stockCode} yearly gain`}
                        value={benchmark.annualizedReturnPct === null ? '—' : signedPercent(benchmark.annualizedReturnPct)}
                        detail={benchmark.endingValue === null ? benchmark.methodology : `${benchmark.stockCode} ending value: ${money(benchmark.endingValue)}`}
                        valueClass={tone(benchmark.annualizedReturnPct ?? 0)}
                    />
                    <SummaryRow
                        label="Max drawdown"
                        value={portfolio.maxDrawdownPct === null ? '—' : signedPercent(portfolio.maxDrawdownPct)}
                        detail={`${portfolio.openPositionCount} open positions at the end of the run`}
                        valueClass={tone(portfolio.maxDrawdownPct ?? 0)}
                    />
                </dl>
            </section>

            <section className="reportSection">
                <h2>Run Facts</h2>
                <dl className="reportFacts">
                    <div>
                        <dt>Largest position</dt>
                        <dd>{percent(portfolio.largestPositionPct)}</dd>
                    </div>
                    <div>
                        <dt>Cash position</dt>
                        <dd>{money(simulation.endingCash)} ({percent(portfolio.cashPct)})</dd>
                    </div>
                    <div>
                        <dt>Unique stocks traded</dt>
                        <dd>{activity.uniqueStocksTraded}</dd>
                    </div>
                </dl>
            </section>

            <section className="reportSection">
                <h2>Tax Profile</h2>
                <dl className="reportFacts">
                    <div>
                        <dt>Unrealized gain exposure</dt>
                        <dd>{signedMoney(portfolioSummary.unrealizedGainLoss)}</dd>
                    </div>
                    <div>
                        <dt>Long-term tax</dt>
                        <dd>{money(taxes.longTermTax)}</dd>
                    </div>
                    <div>
                        <dt>Short-term tax</dt>
                        <dd>{money(taxes.shortTermTax)}</dd>
                    </div>
                    <div>
                        <dt>Dividend tax</dt>
                        <dd>{money(taxes.dividendTax)}</dd>
                    </div>
                    <div>
                        <dt>Total estimated tax</dt>
                        <dd>{money(taxes.estimatedTax)}</dd>
                    </div>
                </dl>
            </section>

            <section className="reportSection">
                <h2>Strategy Check</h2>
                {factualFindings.length === 0 ? (
                    <p className="reportEmptyLine">—</p>
                ) : (
                    <ul className="reportBullets">
                        {factualFindings.map((item) => (
                            <li key={item.text}>{item.text}</li>
                        ))}
                    </ul>
                )}
            </section>

            {safeReport.note && (
                <section className="reportSection">
                    <h2>Note</h2>
                    <p className="reportBody">{safeReport.note}</p>
                </section>
            )}
        </article>
    )
}
