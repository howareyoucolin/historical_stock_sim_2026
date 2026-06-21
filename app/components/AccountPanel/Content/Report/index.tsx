'use client'

import { useEffect } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import type { AssessmentItem, SimulationReport } from '../../../../actions/report/build'
import { money, percent, signedMoney, signedPercent, tone } from '../../../shared/format'
import { loadReport } from './actions'

// Render a scored list of report findings, falling back to a dash when the section is empty.
function ReportList({ items }: { items: Array<Partial<AssessmentItem>> }) {
    if (items.length === 0) {
        return <p className="reportEmptyLine">—</p>
    }

    return (
        <ul className="reportBullets">
            {items.map((item) => (
                <li key={`${item.text ?? 'item'}-${item.score ?? 0}`} className="reportBulletItem">
                    <span>{item.text ?? '—'}</span>
                    <strong>{typeof item.score === 'number' ? item.score.toFixed(2) : '—'}</strong>
                </li>
            ))}
        </ul>
    )
}

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
    }
    const portfolio = safeReport.portfolio ?? {
        openPositionCount: Array.isArray(safeReport.positions) ? safeReport.positions.length : 0,
        cashPct: 0,
        largestPositionPct: 0,
        maxDrawdownPct: null,
    }
    const takeaways = safeReport.takeaways ?? {
        summary: 'No written assessment is available for this report yet.',
        worked: [],
        didNotWork: [],
        nextChanges: [],
    }
    const agentLearning = safeReport.agentLearning ?? {
        reuseScore: 0,
        improvementPotentialScore: 0,
        confidenceScore: 0,
        tags: [],
    }
    const positions = [...(safeReport.positions ?? [])].sort((left, right) => (right.marketValue ?? 0) - (left.marketValue ?? 0))
    const visibleLearningTags = (agentLearning.tags ?? []).filter((tag) => tag !== 'unknown')

    return (
        <article className="reportDoc">
            <header className="reportDocHeader">
                <span className="reportKicker">Simulation Report</span>
                <h1>{strategy.name}</h1>
                <p className="reportLead">{takeaways.summary}</p>
            </header>

            <section className="reportSection">
                <h2>Summary</h2>
                <dl className="reportSummaryList">
                    <SummaryRow label="Principal" value={money(portfolioSummary.principal)} detail="Net contributed capital" />
                    <SummaryRow label="Current total" value={money(portfolioSummary.currentTotal)} detail="Portfolio value at report time" />
                    <SummaryRow
                        label="Total gain/loss"
                        value={signedMoney(portfolioSummary.totalGainLoss)}
                        detail={portfolioSummary.totalReturnPct === null ? '—' : signedPercent(portfolioSummary.totalReturnPct)}
                        valueClass={tone(portfolioSummary.totalGainLoss)}
                    />
                    <SummaryRow
                        label="Max drawdown"
                        value={portfolio.maxDrawdownPct === null ? '—' : signedPercent(portfolio.maxDrawdownPct)}
                        detail={`${portfolio.openPositionCount} open positions`}
                        valueClass={tone(portfolio.maxDrawdownPct ?? 0)}
                    />
                </dl>
            </section>

            <section className="reportSection reportTwoColumn">
                <div>
                    <h2>Objective</h2>
                    <p className="reportBodyStrong">{objective.title}</p>
                    <p className="reportMuted">Primary metric: {objective.primaryMetric}</p>
                    <ul className="reportBullets">
                        {objective.constraints.length === 0 ? <li className="reportEmptyLine">—</li> : objective.constraints.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                </div>

                <div>
                    <h2>Strategy</h2>
                    <p className="reportBodyStrong">{strategy.name} <span className="reportInlineMeta">{strategy.version}</span></p>
                    <p className="reportBody">{strategy.summary}</p>
                </div>
            </section>

            <section className="reportSection">
                <h2>Thesis</h2>
                <p className="reportBody">{thesis.summary}</p>
            </section>

            <section className="reportSection reportTwoColumn">
                <div>
                    <h2>Risk Snapshot</h2>
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
                            <dt>Simulation range</dt>
                            <dd>{simulation.simStartDate ?? '—'} → {simulation.simEndDate}</dd>
                        </div>
                        <div>
                            <dt>Starting value</dt>
                            <dd>{simulation.startingValue === null ? '—' : money(simulation.startingValue)}</dd>
                        </div>
                    </dl>
                </div>

                <div>
                    <h2>Activity</h2>
                    <dl className="reportFacts">
                        <div>
                            <dt>Buys / sells</dt>
                            <dd>{activity.buyCount} / {activity.sellCount}</dd>
                        </div>
                        <div>
                            <dt>Dividends / interest</dt>
                            <dd>{activity.dividendCount} / {activity.interestCount}</dd>
                        </div>
                        <div>
                            <dt>Unique stocks traded</dt>
                            <dd>{activity.uniqueStocksTraded}</dd>
                        </div>
                        <div>
                            <dt>Total events</dt>
                            <dd>{activity.historyEventCount}</dd>
                        </div>
                    </dl>
                </div>
            </section>

            <section className="reportSection">
                <h2>Assessment</h2>
                <div className="reportAssessmentGrid">
                    <div>
                        <h3>What Did Not Work</h3>
                        <ReportList items={takeaways.didNotWork} />
                    </div>

                    <div>
                        <h3>Next Changes</h3>
                        <ReportList items={takeaways.nextChanges} />
                    </div>

                    {takeaways.worked.length > 0 && (
                        <div>
                            <h3>What Worked</h3>
                            <ReportList items={takeaways.worked} />
                        </div>
                    )}
                </div>
            </section>

            {((safeReport.note ?? '') || visibleLearningTags.length > 0) && (
                <section className="reportSection reportTwoColumn">
                    {safeReport.note && (
                        <div>
                            <h2>Note</h2>
                            <p className="reportBody">{safeReport.note}</p>
                        </div>
                    )}

                    {visibleLearningTags.length > 0 && (
                        <div>
                            <h2>Learning Tags</h2>
                            <p className="reportBody">{visibleLearningTags.join(', ')}</p>
                        </div>
                    )}
                </section>
            )}

            <section className="reportSection">
                <h2>Position Snapshot</h2>
                <p className="reportMuted">Anonymized open positions saved into the report for future learning.</p>

                {positions.length === 0 ? (
                    <div className="reportTableEmpty">No open positions were saved in this report.</div>
                ) : (
                    <div className="reportTableScroll">
                        <table className="reportTable">
                            <thead>
                                <tr>
                                    <th className="alignLeft" scope="col">Position</th>
                                    <th scope="col">Shares</th>
                                    <th scope="col">Avg cost</th>
                                    <th scope="col">Last price</th>
                                    <th scope="col">Value</th>
                                    <th scope="col">P/L</th>
                                    <th scope="col">Return</th>
                                    <th scope="col">Weight</th>
                                    <th className="alignLeft" scope="col">Activity</th>
                                </tr>
                            </thead>
                            <tbody>
                                {positions.map((position) => (
                                    <tr key={position.bucket ?? 'position'}>
                                        <td className="alignLeft reportPositionName">{position.bucket ?? 'position'}</td>
                                        <td>{position.sharesHeld ?? '—'}</td>
                                        <td>{typeof position.avgCost === 'number' ? money(position.avgCost) : '—'}</td>
                                        <td>{typeof position.lastPrice === 'number' ? money(position.lastPrice) : '—'}</td>
                                        <td>{typeof position.marketValue === 'number' ? money(position.marketValue) : '—'}</td>
                                        <td className={tone(position.unrealizedGainLoss ?? 0)}>{typeof position.unrealizedGainLoss === 'number' ? signedMoney(position.unrealizedGainLoss) : '—'}</td>
                                        <td className={tone(position.unrealizedGainLossPct ?? 0)}>{typeof position.unrealizedGainLossPct === 'number' ? signedPercent(position.unrealizedGainLossPct) : '—'}</td>
                                        <td>{typeof position.weightPct === 'number' ? percent(position.weightPct) : '—'}</td>
                                        <td className="alignLeft reportPositionActivity">
                                            {(position.activity?.buys ?? 0)} buys, {(position.activity?.sells ?? 0)} sells, {(position.activity?.dividends ?? 0)} dividends
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </article>
    )
}
