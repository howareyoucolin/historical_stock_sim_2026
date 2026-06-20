'use client'

import './style.css'
import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../../../../../store/hooks'
import { money, signedMoney, tone } from '../../../../shared/format'
import { loadHistory } from '../../Histories/actions'
import { buildTaxReport, TAX_RATES, type YearTaxRow } from './taxReport'

// Render one table row: realized gain/loss per category (tone-colored), then the estimated tax owed
// per category (a non-negative cost), then the total estimated tax. A divider class marks where the
// tax group begins so the two halves stay visually distinct in the wide table.
function TaxRow({ row, isTotal }: { row: YearTaxRow; isTotal?: boolean }) {
    return (
        <tr className={isTotal ? 'taxTotalRow' : ''}>
            <td className="taxYear">{row.year}</td>
            <td className={`taxNum ${tone(row.longTermGain)}`}>{signedMoney(row.longTermGain)}</td>
            <td className={`taxNum ${tone(row.shortTermGain)}`}>{signedMoney(row.shortTermGain)}</td>
            <td className={`taxNum ${tone(row.dividendGain)}`}>{signedMoney(row.dividendGain)}</td>
            <td className={`taxNum ${tone(row.interestGain)}`}>{signedMoney(row.interestGain)}</td>
            <td className="taxNum taxGroupStart">{money(row.longTermTax)}</td>
            <td className="taxNum">{money(row.shortTermTax)}</td>
            <td className="taxNum">{money(row.dividendTax)}</td>
            <td className="taxNum">{money(row.interestTax)}</td>
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
                <div className="taxReportEmpty">No taxable activity yet. Sells, dividends, and interest show up here once they happen.</div>
            ) : (
                <>
                    <div className="taxTableWrap">
                        <table className="taxTable">
                            <thead>
                                {/* Two-tier header: group labels span the gain and tax halves; the row below
                                    names each category so "gain"/"tax" need not repeat in every cell. */}
                                <tr>
                                    <th className="taxYear" rowSpan={2}>Year</th>
                                    <th className="groupHead" colSpan={4}>Realized Gain / Loss</th>
                                    <th className="groupHead taxGroupStart" colSpan={5}>Estimated Tax</th>
                                </tr>
                                <tr>
                                    <th>Long-term</th>
                                    <th>Short-term</th>
                                    <th>Dividend</th>
                                    <th>Interest</th>
                                    <th className="taxGroupStart">Long-term</th>
                                    <th>Short-term</th>
                                    <th>Dividend</th>
                                    <th>Interest</th>
                                    <th>Total</th>
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
