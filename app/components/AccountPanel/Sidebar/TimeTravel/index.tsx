'use client'

import { useRef } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { openCalendar } from '../../../../store/uiSlice'
import { advanceToNextDay } from './actions'

// Render the "Next Day" and "Fast Forward" controls. Fast Forward measures its own button so the
// calendar popover can anchor itself, then stores the resolved position in the ui slice.
export function TimeTravel() {
    const dispatch = useAppDispatch()
    const isBusy = useAppSelector((state) => state.account.isBusy)
    const fastForwardRef = useRef<HTMLButtonElement>(null)

    // Open the calendar popover anchored to the right of the Fast Forward button, clamped to the viewport.
    function handleOpenCalendar(): void {
        const rect = fastForwardRef.current?.getBoundingClientRect()

        if (rect) {
            const top = Math.max(8, Math.min(rect.top, window.innerHeight - 360))
            dispatch(openCalendar({ top, left: rect.right + 8 }))
        } else {
            dispatch(openCalendar(null))
        }
    }

    return (
        <section className="dateBox">
            <h2>Time travel</h2>
            <div className="dateButtons">
                <button className="nextDayButton" type="button" onClick={() => void dispatch(advanceToNextDay())} disabled={isBusy}>
                    Next Day
                </button>
                <button ref={fastForwardRef} className="fastForwardButton" type="button" onClick={handleOpenCalendar} disabled={isBusy}>
                    Fast Forward
                </button>
            </div>
        </section>
    )
}
