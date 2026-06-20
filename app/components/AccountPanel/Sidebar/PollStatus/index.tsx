'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { setPollPaused, setPollStatus } from '../../../../store/uiSlice'

// Human-readable label for each active (non-paused) poll lifecycle state.
const POLL_LABELS = {
    polling: 'polling',
    updating: 'updating ui',
    updated: 'ui updated',
    nochange: 'nothing to update',
} as const

// In-progress states show animated trailing dots; settled results (updated / nothing) do not.
const ANIMATED_STATES = new Set(['polling', 'updating'])

// Render the subtle background-refresh status at the bottom of the sidebar, so the user can see the
// 5-second poll cycle. After a long idle stretch the loop auto-pauses and this offers a resume link.
export function PollStatus() {
    const dispatch = useAppDispatch()
    const status = useAppSelector((state) => state.ui.pollStatus)

    // Resume polling and reset the indicator to its waiting state.
    function resume() {
        dispatch(setPollPaused(false))
        dispatch(setPollStatus('polling'))
    }

    if (status === 'paused') {
        return (
            <div className="pollStatus pollStatusPaused">
                <span>Idle for a while, auto-refresh paused.</span>{' '}
                <button type="button" className="pollResume" onClick={resume}>
                    resume polling
                </button>
            </div>
        )
    }

    return (
        <div className="pollStatus">
            <span>{POLL_LABELS[status]}</span>
            {ANIMATED_STATES.has(status) && (
                <span className="pollDots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                </span>
            )}
        </div>
    )
}
