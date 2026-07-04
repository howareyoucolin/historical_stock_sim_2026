'use client'

import { useEffect } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { openSessionModal } from '../../../../store/uiSlice'
import { loadSessions } from '../../overlays/SessionModal/actions'

// Bottom-left sidebar control: a "Current session" label above a 🗂️ Sessions button that opens the
// session management modal. Replaces the old standalone Reset button (reset now lives in the modal).
export function SessionsControl() {
    const dispatch = useAppDispatch()
    const active = useAppSelector((state) => state.session.active)

    // Load the session list on mount so the label reflects the true active session right away
    // (e.g. after it was switched from the CLI), not just after the modal is opened.
    useEffect(() => {
        void dispatch(loadSessions())
    }, [dispatch])

    return (
        <div className="sessionsControlWrap">
            <span className="sessionsControlLabel">
                Current session: <span className="sessionsControlCurrent">{active}</span>
            </span>
            <button className="sessionsControl" type="button" onClick={() => dispatch(openSessionModal())} title={`Active session: ${active}`}>
                <span className="sessionsControlIcon" aria-hidden="true">🗂️</span>
                <span className="sessionsControlText">Sessions</span>
            </button>
        </div>
    )
}
