'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import './style.css'
import { useAppSelector } from '../../../../../store/hooks'
import { marketCap, money, signedMoney, signedPercent, tone } from '../../../../shared/format'
import type { StockPricePoint } from '../../../../../actions/stock/analysis'

// Chart paddings mirror the Summary graph so both views read consistently; padLeft fits a price label.
const PAD = { top: 16, right: 14, bottom: 36, left: 64 }
const GRID_LINE_COUNT = 4
const HEIGHT_DIVISOR = 2.4
const MIN_HEIGHT = 220
const MAX_HEIGHT = 360
const FALLBACK_WIDTH = 640

// Trailing windows offered above the chart; each maps the as-of date to the earliest date it shows.
const RANGES: Array<{ id: string; label: string; cutoff: (asOfDate: string) => string }> = [
    { id: '1M', label: '1M', cutoff: (date) => shiftDays(date, -30) },
    { id: '6M', label: '6M', cutoff: (date) => shiftDays(date, -182) },
    { id: 'YTD', label: 'YTD', cutoff: (date) => `${date.slice(0, 4)}-01-01` },
    { id: '1Y', label: '1Y', cutoff: (date) => shiftDays(date, -365) },
    { id: 'MAX', label: 'Max', cutoff: () => '0000-01-01' },
]

// Shift an ISO date by a number of calendar days in UTC, returning a YYYY-MM-DD string.
function shiftDays(dateString: string, dayCount: number): string {
    const date = new Date(`${dateString}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + dayCount)

    return date.toISOString().slice(0, 10)
}

interface PlottedPoint {
    x: number
    y: number
    point: StockPricePoint
}

interface ChartGeometry {
    points: PlottedPoint[]
    gridLines: Array<{ y: number; value: number }>
    plotBottom: number
}

// Project the visible price points and gridlines onto pixel coordinates for the current chart size.
function buildChartGeometry(series: StockPricePoint[], width: number, height: number): ChartGeometry {
    const plotWidth = width - PAD.left - PAD.right
    const plotHeight = height - PAD.top - PAD.bottom
    const plotBottom = PAD.top + plotHeight

    const closes = series.map((entry) => entry.close)
    const rawMin = Math.min(...closes)
    const rawMax = Math.max(...closes)
    const min = rawMin === rawMax ? rawMin - 1 : rawMin
    const max = rawMin === rawMax ? rawMax + 1 : rawMax

    const points = series.map((entry, index) => {
        const ratioX = series.length === 1 ? 0.5 : index / (series.length - 1)
        const ratioY = (entry.close - min) / (max - min)

        return { x: PAD.left + ratioX * plotWidth, y: PAD.top + (1 - ratioY) * plotHeight, point: entry }
    })

    const gridLines = Array.from({ length: GRID_LINE_COUNT + 1 }, (_, index) => {
        const ratio = index / GRID_LINE_COUNT

        return { y: PAD.top + ratio * plotHeight, value: max - ratio * (max - min) }
    })

    return { points, gridLines, plotBottom }
}

// Format a figure that may be unavailable, falling back to a dash.
function stat(value: number | null): string {
    return value === null ? '—' : money(value)
}

// Render the main analysis area for the selected stock: a price line with selectable trailing
// windows, the as-of day change, and a grid of figures measured on the simulation date.
export function StockChart() {
    const selectedStock = useAppSelector((state) => state.analysis.selectedStock)
    const analysis = useAppSelector((state) => state.analysis.analysis)
    const stockInfo = useAppSelector((state) => state.analysis.stockInfo)
    const isLoading = useAppSelector((state) => state.analysis.isLoading)
    const error = useAppSelector((state) => state.analysis.error)

    const [rangeId, setRangeId] = useState('1Y')
    const [activeIndex, setActiveIndex] = useState<number | null>(null)
    const [width, setWidth] = useState(FALLBACK_WIDTH)
    const wrapRef = useRef<HTMLDivElement>(null)

    // Track the container width so the chart redraws at its true pixel size on layout/resize.
    useEffect(() => {
        const wrap = wrapRef.current

        if (!wrap) {
            return
        }

        const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
        observer.observe(wrap)

        return () => observer.disconnect()
    }, [analysis])

    if (selectedStock === null) {
        return <div className="stockChartEmpty">Select a stock to see its chart and figures.</div>
    }

    if (isLoading) {
        return <div className="stockChartEmpty">Loading {selectedStock}…</div>
    }

    if (error !== null || analysis === null || stockInfo === null) {
        return <div className="stockChartEmpty">{error ?? `No data for ${selectedStock}.`}</div>
    }

    const range = RANGES.find((entry) => entry.id === rangeId) ?? RANGES[3]
    const cutoff = range.cutoff(analysis.asOfDate)
    // Always keep at least the last two points so a short window still draws a line.
    const visible = analysis.points.filter((entry) => entry.date >= cutoff)
    const series = visible.length >= 2 ? visible : analysis.points.slice(-2)

    const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(width / HEIGHT_DIVISOR)))
    const { points, gridLines, plotBottom } = buildChartGeometry(series, width, height)
    const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${plotBottom.toFixed(1)} L ${points[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`

    // The chart line is toned by the move across the visible window; the header change is the day move.
    const windowChange = series[series.length - 1].close - series[0].close
    const trendTone = tone(windowChange)
    const dayTone = tone(analysis.change ?? 0)

    // Map the pointer's horizontal position to the nearest plotted day.
    function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const wrap = wrapRef.current

        if (!wrap) {
            return
        }

        const offsetX = event.clientX - wrap.getBoundingClientRect().left
        const ratio = points.length === 1 ? 0 : (offsetX - PAD.left) / (width - PAD.left - PAD.right)
        const nearest = Math.round(ratio * (points.length - 1))

        setActiveIndex(Math.max(0, Math.min(points.length - 1, nearest)))
    }

    const active = activeIndex === null ? null : points[activeIndex]

    return (
        <section className="stockChart">
            <header className="stockChartHeader">
                <div>
                    <h3 className="stockChartCode">{analysis.stockCode}</h3>
                    <h2 className="stockChartCompanyName">{stockInfo.companyName}</h2>
                    <div className="stockChartMeta">
                        <span>{stockInfo.segment}</span>
                        <span>{stockInfo.industry}</span>
                    </div>
                    <span className="stockChartPrice">{money(analysis.close)} <span className="stockChartCurrency">USD</span></span>
                </div>
                <div className={`stockChartChange ${dayTone}`}>
                    {analysis.change === null ? (
                        <span className="stockChartChangeAmount">No prior close</span>
                    ) : (
                        <span className="stockChartChangeAmount">{signedMoney(analysis.change)} ({signedPercent(analysis.changePercent ?? 0)})</span>
                    )}
                    <span className="stockChartAsOf">as of {analysis.asOfDate}</span>
                </div>
            </header>

            <section className="stockChartProfile" aria-label="Company profile">
                <p className="stockChartSummary">{stockInfo.summary}</p>
            </section>

            <div className="stockChartRanges" role="tablist" aria-label="Chart range">
                {RANGES.map((entry) => (
                    <button
                        key={entry.id}
                        type="button"
                        role="tab"
                        aria-selected={entry.id === rangeId}
                        className={`stockChartRange ${entry.id === rangeId ? 'active' : ''}`}
                        onClick={() => setRangeId(entry.id)}
                    >
                        {entry.label}
                    </button>
                ))}
            </div>

            <div
                className="stockChartWrap"
                ref={wrapRef}
                onPointerMove={handlePointerMove}
                onPointerLeave={() => setActiveIndex(null)}
            >
                <svg
                    className="stockChartSvg"
                    width={width}
                    height={height}
                    role="img"
                    aria-label={`${analysis.stockCode} closing price, ${money(analysis.close)} on ${analysis.asOfDate}`}
                >
                    {gridLines.map((line, index) => (
                        <line key={index} className="chartGrid" x1={PAD.left} y1={line.y} x2={width - PAD.right} y2={line.y} />
                    ))}

                    <path className={`chartArea ${trendTone}`} d={areaPath} />
                    <path className={`chartLine ${trendTone}`} d={linePath} />

                    {active && (
                        <g className="chartMarker">
                            <line className="chartMarkerLine" x1={active.x} y1={PAD.top} x2={active.x} y2={plotBottom} />
                            <circle className={`chartMarkerDot ${trendTone}`} cx={active.x} cy={active.y} r={4} />
                        </g>
                    )}
                </svg>

                {gridLines.map((line, index) => (
                    <span key={index} className="chartYLabel" style={{ top: `${line.y}px`, width: `${PAD.left - 8}px` }}>
                        {money(line.value)}
                    </span>
                ))}
                <span className="chartXLabel" style={{ left: `${points[0].x}px`, top: `${plotBottom + 14}px` }}>{series[0].date}</span>
                <span className="chartXLabel end" style={{ left: `${points[points.length - 1].x}px`, top: `${plotBottom + 14}px` }}>{series[series.length - 1].date}</span>

                {active && (
                    <div className="chartTooltip" style={{ left: `${active.x}px`, top: `${active.y}px` }}>
                        <span className="chartTooltipDate">{active.point.date}</span>
                        <span className="chartTooltipValue">{money(active.point.close)}</span>
                    </div>
                )}
            </div>

            <dl className="stockChartStats">
                <div className="stockChartStat">
                    <dt>Previous close</dt>
                    <dd>{stat(analysis.previousClose)}</dd>
                </div>
                <div className="stockChartStat">
                    <dt>Market cap</dt>
                    <dd>{marketCap(analysis.marketCap)}</dd>
                </div>
                <div className="stockChartStat">
                    <dt>P/E ratio</dt>
                    <dd>{analysis.peRatio === null ? '—' : analysis.peRatio.toFixed(2)}</dd>
                </div>
                <div className="stockChartStat">
                    <dt>TTM EPS</dt>
                    <dd>{stat(analysis.ttmEps)}</dd>
                </div>
                <div className="stockChartStat">
                    <dt>52-wk high</dt>
                    <dd>{money(analysis.high52)}</dd>
                </div>
                <div className="stockChartStat">
                    <dt>52-wk low</dt>
                    <dd>{money(analysis.low52)}</dd>
                </div>
                <div className="stockChartStat">
                    <dt>Last dividend</dt>
                    <dd>{analysis.lastDividendPerShare === null ? '—' : `${money(analysis.lastDividendPerShare)} (${analysis.lastDividendDate})`}</dd>
                </div>
            </dl>
        </section>
    )
}
