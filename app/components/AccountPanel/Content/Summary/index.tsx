'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { money, signedMoney, signedPercent, tone } from '../../../shared/format'
import type { DailyValueSnapshot } from '../../../../actions/account/values-log'
import { loadValues } from './actions'
import { TaxReport } from './TaxReport'

// The chart is drawn in real pixels (measured container width) so axis fonts and the left gutter stay
// a fixed size instead of scaling up with the SVG. padLeft fits up to a seven-digit money label.
const PAD = { top: 16, right: 14, bottom: 36, left: 84 }
const GRID_LINE_COUNT = 4
const HEIGHT_DIVISOR = 2.6
const MIN_HEIGHT = 240
const MAX_HEIGHT = 400
const FALLBACK_WIDTH = 760

interface PlottedPoint {
    x: number
    y: number
    snapshot: DailyValueSnapshot
}

interface ChartGeometry {
    points: PlottedPoint[]
    gridLines: Array<{ y: number; value: number }>
    plotBottom: number
}

// Project the value series and gridlines onto pixel coordinates for the current chart size, padding a
// flat series so it renders mid-height.
function buildChartGeometry(snapshots: DailyValueSnapshot[], width: number, height: number): ChartGeometry {
    const plotWidth = width - PAD.left - PAD.right
    const plotHeight = height - PAD.top - PAD.bottom
    const plotBottom = PAD.top + plotHeight

    const values = snapshots.map((snapshot) => snapshot.value)
    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)
    const min = rawMin === rawMax ? rawMin - 1 : rawMin
    const max = rawMin === rawMax ? rawMax + 1 : rawMax

    const points = snapshots.map((snapshot, index) => {
        const ratioX = snapshots.length === 1 ? 0.5 : index / (snapshots.length - 1)
        const ratioY = (snapshot.value - min) / (max - min)

        return {
            x: PAD.left + ratioX * plotWidth,
            y: PAD.top + (1 - ratioY) * plotHeight,
            snapshot,
        }
    })

    const gridLines = Array.from({ length: GRID_LINE_COUNT + 1 }, (_, index) => {
        const ratio = index / GRID_LINE_COUNT

        return { y: PAD.top + ratio * plotHeight, value: max - ratio * (max - min) }
    })

    return { points, gridLines, plotBottom }
}

// Render the Summary tab: a line graph of the portfolio's daily total value (cash + holdings),
// reloaded from the value log each time the tab mounts so it reflects the latest simulated days.
export function Summary() {
    const dispatch = useAppDispatch()
    const snapshots = useAppSelector((state) => state.account.valueSnapshots)
    const currentDate = useAppSelector((state) => state.account.view.account.date)

    const wrapRef = useRef<HTMLDivElement>(null)
    // Index of the day the pointer is hovering over; null when the pointer is away from the chart.
    const [activeIndex, setActiveIndex] = useState<number | null>(null)
    // The simulation date the chart currently reflects. The graph is reloaded only on mount and on an
    // explicit refresh, so advancing the date repeatedly never reloads this component on its own.
    const [syncedDate, setSyncedDate] = useState<string | null>(null)
    // The chart's pixel width, measured from its container so the drawing stays crisp and responsive.
    const [width, setWidth] = useState(FALLBACK_WIDTH)

    // A ref lets the mount-only effect read the latest date without re-running when the date changes,
    // which is what would otherwise turn this into the unwanted auto-refresh.
    const currentDateRef = useRef(currentDate)
    currentDateRef.current = currentDate

    useEffect(() => {
        const dateAtMount = currentDateRef.current

        void dispatch(loadValues()).then(() => setSyncedDate(dateAtMount))
    }, [dispatch])

    // Track the container width so the chart redraws at its true pixel size on layout/resize.
    useEffect(() => {
        const wrap = wrapRef.current

        if (!wrap) {
            return
        }

        const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
        observer.observe(wrap)

        return () => observer.disconnect()
    }, [snapshots.length])

    // Reload the value series for the current date once, on user request, then clear the stale flag.
    function refreshGraph() {
        const dateAtRefresh = currentDate

        void dispatch(loadValues()).then(() => setSyncedDate(dateAtRefresh))
    }

    // The chart lags the simulation once the date has moved past what the loaded series covers.
    const isStale = syncedDate !== null && syncedDate !== currentDate

    if (snapshots.length === 0) {
        return (
            <div className="summaryEmpty">
                {isStale ? (
                    <>
                        <p className="summaryStaleText">The simulation advanced to {currentDate}. Refresh to load your value history.</p>
                        <button type="button" className="summaryRefreshButton" onClick={refreshGraph}>Refresh view</button>
                    </>
                ) : (
                    'No value history yet. Advance the simulation date to start tracking your daily total value.'
                )}
            </div>
        )
    }

    const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(width / HEIGHT_DIVISOR)))
    const { points, gridLines, plotBottom } = buildChartGeometry(snapshots, width, height)
    const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${plotBottom.toFixed(1)} L ${points[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`

    const first = snapshots[0]
    const last = snapshots[snapshots.length - 1]
    const change = last.value - first.value
    const changePercent = first.value === 0 ? 0 : (change / first.value) * 100
    const trendTone = tone(change)

    // Map the pointer's horizontal position to the nearest day. Coordinates are already in pixels, so
    // the offset within the container maps straight onto the plot.
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
    const activeChange = active ? active.snapshot.value - first.value : 0
    const activeChangePercent = active && first.value !== 0 ? (activeChange / first.value) * 100 : 0

    return (
        <section className="summary">
            <header className="summaryHeader">
                <div>
                    <span className="summaryLabel">Total Value</span>
                    <span className="summaryValue">{money(last.value)}</span>
                </div>
                <div className={`summaryChange ${trendTone}`}>
                    <span className="summaryChangeAmount">{signedMoney(change)} ({signedPercent(changePercent)})</span>
                    <span className="summaryRange">{first.date} → {last.date}</span>
                </div>
            </header>

            <div
                className="summaryChartWrap"
                ref={wrapRef}
                onPointerMove={handlePointerMove}
                onPointerLeave={() => setActiveIndex(null)}
            >
                <svg
                    className="summaryChart"
                    width={width}
                    height={height}
                    role="img"
                    aria-label={`Daily total value from ${first.date} to ${last.date}, ${money(last.value)}`}
                >
                    {/* Horizontal gridlines give the line a readable scale; value labels are HTML overlays. */}
                    {gridLines.map((line, index) => (
                        <line key={index} className="chartGrid" x1={PAD.left} y1={line.y} x2={width - PAD.right} y2={line.y} />
                    ))}

                    <path className={`chartArea ${trendTone}`} d={areaPath} />
                    <path className={`chartLine ${trendTone}`} d={linePath} />

                    {/* Hover marker: a vertical guide and a dot pinned to the day under the pointer. */}
                    {active && !isStale && (
                        <g className="chartMarker">
                            <line className="chartMarkerLine" x1={active.x} y1={PAD.top} x2={active.x} y2={plotBottom} />
                            <circle className={`chartMarkerDot ${trendTone}`} cx={active.x} cy={active.y} r={4} />
                        </g>
                    )}
                </svg>

                {/* Axis labels are HTML so their font size stays fixed regardless of chart width. */}
                {gridLines.map((line, index) => (
                    <span key={index} className="chartYLabel" style={{ top: `${line.y}px`, width: `${PAD.left - 8}px` }}>
                        {money(line.value)}
                    </span>
                ))}
                <span className="chartXLabel" style={{ left: `${points[0].x}px`, top: `${plotBottom + 14}px` }}>{first.date}</span>
                <span className="chartXLabel end" style={{ left: `${points[points.length - 1].x}px`, top: `${plotBottom + 14}px` }}>{last.date}</span>

                {active && !isStale && (
                    <div className="chartTooltip" style={{ left: `${active.x}px`, top: `${active.y}px` }}>
                        <span className="chartTooltipDate">{active.snapshot.date}</span>
                        <span className="chartTooltipValue">{money(active.snapshot.value)}</span>
                        <span className={`chartTooltipChange ${tone(activeChange)}`}>
                            {signedMoney(activeChange)} ({signedPercent(activeChangePercent)})
                        </span>
                    </div>
                )}

                {/* The graph is left untouched while the date moves; an overlay invites a manual refresh
                    so rapidly stepping the date never triggers a reload on every press. */}
                {isStale && (
                    <div className="summaryStaleOverlay">
                        <p className="summaryStaleText">Showing {syncedDate}. The simulation is now at {currentDate}.</p>
                        <button type="button" className="summaryRefreshButton" onClick={refreshGraph}>Refresh view</button>
                    </div>
                )}
            </div>

            <TaxReport />
        </section>
    )
}
