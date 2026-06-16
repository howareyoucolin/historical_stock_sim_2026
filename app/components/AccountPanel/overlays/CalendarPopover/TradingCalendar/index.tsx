'use client'

import { useEffect, useMemo, useState } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../../store/hooks'
import { selectTradingDate } from './actions'

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Pad a number to a two-digit string for ISO date assembly.
function pad(value: number): string {
    return String(value).padStart(2, '0')
}

// Build an ISO YYYY-MM-DD string for a calendar cell.
function isoDate(year: number, monthIndex: number, day: number): string {
    return `${year}-${pad(monthIndex + 1)}-${pad(day)}`
}

// Render a month-grid date picker where only future trading days (weekday, non-holiday) are
// selectable. The trading calendar, current date, and busy flag are read from the store; the
// visible month is local view state.
export function TradingCalendar() {
    const dispatch = useAppDispatch()
    const tradingDates = useAppSelector((state) => state.account.tradingDates)
    const currentDate = useAppSelector((state) => state.account.view.account.date)
    const disabled = useAppSelector((state) => state.account.isBusy)

    const tradingSet = useMemo(() => new Set(tradingDates), [tradingDates])
    const [year, setYear] = useState(() => Number(currentDate.slice(0, 4)))
    const [monthIndex, setMonthIndex] = useState(() => Number(currentDate.slice(5, 7)) - 1)

    // Re-center the calendar on the simulation month whenever the date advances.
    useEffect(() => {
        setYear(Number(currentDate.slice(0, 4)))
        setMonthIndex(Number(currentDate.slice(5, 7)) - 1)
    }, [currentDate])

    const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay()
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
    const cells: Array<number | null> = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)]

    // Step the displayed month by a number of months, wrapping the year as needed.
    function shiftMonth(delta: number): void {
        const next = new Date(Date.UTC(year, monthIndex + delta, 1))

        setYear(next.getUTCFullYear())
        setMonthIndex(next.getUTCMonth())
    }

    return (
        <div className="calendar">
            <div className="calendarNav">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                    ‹
                </button>
                <span className="calendarMonth">
                    {MONTH_LABELS[monthIndex]} {year}
                </span>
                <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month">
                    ›
                </button>
            </div>
            <div className="calendarGrid">
                {WEEKDAY_LABELS.map((label) => (
                    <span className="calendarWeekday" key={label}>
                        {label}
                    </span>
                ))}
                {cells.map((day, index) => {
                    if (day === null) {
                        return <span className="calendarCell empty" key={`empty-${index}`} />
                    }

                    const date = isoDate(year, monthIndex, day)
                    const isSelectable = !disabled && date > currentDate && tradingSet.has(date)

                    return (
                        <button
                            type="button"
                            key={date}
                            className="calendarCell"
                            disabled={!isSelectable}
                            onClick={() => void dispatch(selectTradingDate(date))}
                            title={isSelectable ? `Fast forward to ${date}` : 'Market closed'}
                        >
                            {day}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
