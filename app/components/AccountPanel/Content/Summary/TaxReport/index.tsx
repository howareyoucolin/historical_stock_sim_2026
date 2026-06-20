'use client'

import './style.css'
import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../../../../../store/hooks'
import { money, signedMoney, tone } from '../../../../shared/format'
import { loadHistory } from '../../Histories/actions'
import { buildTaxReport, TAX_RATES, type YearTaxRow } from './taxReport'

// Render one table row of realized gains and estimated tax. Gains are tone-colored; tax is always
// a non-negative cost, so it is shown plainly.
function TaxRow({ row, isTotal }: { row: YearTaxRow; isTotal?: boolean }) {
    return (
        <tr className={isTotal ? 'taxTotalRow' : ''}>
            <td className="taxYear">{row.year}</td>
            <td className={`taxNum ${tone(row.longTermGain)}`}>{signedMoney(row.longTermGain)}</td>
            <td className={`taxNum ${tone(row.shortTermGain)}`}>{signedMoney(row.shortTermGain)}</td>
            <td className={`taxNum ${tone(row.dividendGain)}`}>{signedMoney(row.dividendGain)}</td>
            <td className={`taxNum ${tone(row.interestGain)}`}>{signedMoney(row.interestGain)}</td>
            <td className="taxNum taxOwed">{money(row.estimatedTax)}</td>
        </tr>
    )
}

// Format an assumed tax rate as a whole-number percent for the footnote.
function ratePercent(rate: number): string {
    return `${Math.round(rate * 100)}%`
}

// Render the per-year realized-gain and estimated-tax table beneath the value chart in the Summary tab.
// Data is derived from the recorded history log, so it tracks every buy, sell, and dividend in the run.
export function TaxReport() {
    const dispatch = useAppDispatch()
    const historyEntries = useAppSelector((state) => state.account.historyEntries)

    // Load history here too so the table is populated even when Summary is the first tab opened.
    useEffect(() => {
        void dispatch(loadHistory())
    }, [dispatch])

    const report = buildTaxReport(historyEntries)

    return (
        <section className="taxReport">
            <header className="taxReportHead">
                <h2>Realized Gains &amp; Estimated Tax</h2>
                <span className="taxReportSub">By simulated year</span>
            </header>

            {report.years.length === 0 ? (
                <div className="taxReportEmpty">No realized gains yet. Sells and dividends show up here once they happen.</div>
            ) : (
                <>
                    <div className="taxTableWrap">
                        <table className="taxTable">
                            <thead>
                                <tr>
                                    <th className="taxYear">Year</th>
                                    <th>Long-term gain</th>
                                    <th>Short-term gain</th>
                                    <th>Dividend gain</th>
                                    <th>Interest gain</th>
                                    <th>Estimated tax</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.years.map((row) => (
                                    <TaxRow key={row.year} row={row} />
                                ))}
                                <TaxRow row={report.total} isTotal />
                            </tbody>
                        </table>
                    </div>

                    <p className="taxReportNote">
                        Estimated tax assumes long-term gains and qualified dividends at {ratePercent(TAX_RATES.longTerm)}, and
                        short-term gains and interest at {ratePercent(TAX_RATES.shortTerm)} (ordinary income). Net losses in a
                        category are not credited. Estimate only — not tax advice.
                    </p>
                </>
            )}
        </section>
    )
}
