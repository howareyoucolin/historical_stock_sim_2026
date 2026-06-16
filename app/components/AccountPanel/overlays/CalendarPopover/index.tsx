'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { closeCalendar } from '../../../../store/uiSlice'
import { TradingCalendar } from './TradingCalendar'

// Render the fast-forward calendar popover, anchored to the position the time-travel control
// stored in the ui slice. Renders nothing while the popover is closed.
export function CalendarPopover() {
    const dispatch = useAppDispatch()
    const isCalendarOpen = useAppSelector((state) => state.ui.isCalendarOpen)
    const calendarPosition = useAppSelector((state) => state.ui.calendarPosition)

    if (!isCalendarOpen) {
        return null
    }

    return (
        <>
            <div className="popoverBackdrop" onClick={() => dispatch(closeCalendar())} />
            <div
                className="calendarPopover"
                role="dialog"
                aria-label="Fast forward to a date"
                style={calendarPosition ? { top: calendarPosition.top, left: calendarPosition.left } : undefined}
            >
                <div className="popoverHead">
                    <span>Fast forward to…</span>
                    <button type="button" className="popoverClose" onClick={() => dispatch(closeCalendar())} aria-label="Close calendar">
                        ×
                    </button>
                </div>
                <TradingCalendar />
            </div>
        </>
    )
}
