'use client'

import { useEffect, useState } from 'react'

import './style.css'
import type { StockAnalysis } from '../../../../actions/stock/analysis'
import type { StockInfo } from '../../../../actions/stock/info'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { closeStockInfoModal } from '../../../../store/uiSlice'
import { marketCap, money, signedMoney, signedPercent, tone } from '../../../shared/format'

interface StockInfoModalPayload {
    analysis?: StockAnalysis
    info?: StockInfo
    error?: string
}

function stat(value: number | null): string {
    return value === null ? '—' : money(value)
}

// Label for a fundamental (EPS/P/E) that has no value in the market data as of the simulation date.
// The dataset only begins carrying these figures partway through its range, so before then the
// honest answer is "not reported yet" — never a fabricated or future-sourced number.
const NOT_REPORTED = 'Not reported yet'

// Render a read-only stock snapshot modal for a clicked holding using the same analysis payload as
// the Analysis tab, without changing the trade form or the Analysis tab selection.
export function StockInfoModal() {
    const dispatch = useAppDispatch()
    const isOpen = useAppSelector((state) => state.ui.isStockInfoModalOpen)
    const stockCode = useAppSelector((state) => state.ui.stockInfoModalCode)
    const [analysis, setAnalysis] = useState<StockAnalysis | null>(null)
    const [stockInfo, setStockInfo] = useState<StockInfo | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        if (!isOpen || stockCode === null) {
            setAnalysis(null)
            setStockInfo(null)
            setError(null)
            setIsLoading(false)
            return
        }

        let cancelled = false

        const load = async () => {
            setIsLoading(true)
            setError(null)

            try {
                const response = await fetch(`/api/stock/analysis?code=${encodeURIComponent(stockCode)}`, { cache: 'no-store' })
                const payload = (await response.json()) as StockInfoModalPayload

                if (!response.ok || !payload.analysis || !payload.info) {
                    throw new Error(payload.error ?? `Could not load data for ${stockCode}.`)
                }

                if (!cancelled) {
                    setAnalysis(payload.analysis)
                    setStockInfo(payload.info)
                    setError(null)
                }
            } catch (loadError) {
                if (!cancelled) {
                    setAnalysis(null)
                    setStockInfo(null)
                    setError(loadError instanceof Error ? loadError.message : String(loadError))
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }

        void load()

        return () => {
            cancelled = true
        }
    }, [isOpen, stockCode])

    if (!isOpen || stockCode === null) {
        return null
    }

    const dayTone = tone(analysis?.change ?? 0)

    return (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="stockInfoTitle">
            <div className="modalCard stockInfoModalCard">
                <div className="stockInfoModalHeader">
                    <div>
                        <h3 id="stockInfoTitle">{stockCode}</h3>
                        <p className="stockInfoModalLead">Company snapshot from the current simulation date.</p>
                    </div>
                    <button type="button" className="modalCancel" onClick={() => dispatch(closeStockInfoModal())}>
                        Close
                    </button>
                </div>

                {isLoading ? (
                    <p className="stockInfoModalState">Loading company info…</p>
                ) : error !== null || analysis === null || stockInfo === null ? (
                    <p className="stockInfoModalState">{error ?? `No data for ${stockCode}.`}</p>
                ) : (
                    <div className="stockInfoModalBody">
                        <section className="stockInfoModalHero">
                            <div>
                                <p className="stockInfoModalCode">{analysis.stockCode}</p>
                                <h4 className="stockInfoModalName">{stockInfo.companyName}</h4>
                                <div className="stockInfoModalMeta">
                                    <span>{stockInfo.segment}</span>
                                    <span>{stockInfo.industry}</span>
                                </div>
                            </div>
                            <div className={`stockInfoModalPriceBlock ${dayTone}`}>
                                <span className="stockInfoModalPrice">{money(analysis.close)}</span>
                                <span className="stockInfoModalAsOf">as of {analysis.asOfDate}</span>
                                {analysis.change === null ? (
                                    <span className="stockInfoModalChange">No prior close</span>
                                ) : (
                                    <span className="stockInfoModalChange">{signedMoney(analysis.change)} ({signedPercent(analysis.changePercent ?? 0)})</span>
                                )}
                            </div>
                        </section>

                        <section className="stockInfoModalProfile">
                            <p className="stockInfoModalSummary">{stockInfo.summary}</p>
                        </section>

                        <dl className="stockInfoModalStats">
                            <div>
                                <dt>Previous close</dt>
                                <dd>{stat(analysis.previousClose)}</dd>
                            </div>
                            <div>
                                <dt>Market cap</dt>
                                <dd>{marketCap(analysis.marketCap)}</dd>
                            </div>
                            <div>
                                <dt>P/E ratio</dt>
                                <dd>{analysis.peRatio === null ? NOT_REPORTED : analysis.peRatio.toFixed(2)}</dd>
                            </div>
                            <div>
                                <dt>TTM EPS</dt>
                                <dd>{analysis.ttmEps === null ? NOT_REPORTED : money(analysis.ttmEps)}</dd>
                            </div>
                            <div>
                                <dt>52-wk high</dt>
                                <dd>{money(analysis.high52)}</dd>
                            </div>
                            <div>
                                <dt>52-wk low</dt>
                                <dd>{money(analysis.low52)}</dd>
                            </div>
                            <div>
                                <dt>Last dividend</dt>
                                <dd>{analysis.lastDividendPerShare === null ? `None as of ${analysis.asOfDate}` : `${money(analysis.lastDividendPerShare)} (${analysis.lastDividendDate})`}</dd>
                            </div>
                        </dl>
                    </div>
                )}
            </div>
        </div>
    )
}
