import type { AppThunk } from '../../../../store'
import { setSessions, setSessionError, setSessionSwitching, type SessionSummary } from '../../../../store/sessionSlice'
import { setBusy, setStatus, setView, type AccountResponse } from '../../../../store/accountSlice'
import { closeSessionModal, setActiveTab } from '../../../../store/uiSlice'
import { loadAccountSnapshot, loadTradingCalendar } from '../../actions'
import { loadHistory } from '../../Content/Histories/actions'

// Minimum on-screen time for the switch loading state so the transition reads as a deliberate load
// rather than a flicker, even when the new session's data returns almost instantly.
const SWITCH_LOADING_MS = 700

// Small promise-based delay used to hold the loading state for the minimum duration.
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

interface SessionListResponse {
    sessions?: SessionSummary[]
    error?: string
}

// Load the list of sessions (with the active one flagged) into the store.
export function loadSessions(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        const response = await fetch('/api/session', { cache: 'no-store' })
        const payload = (await response.json()) as SessionListResponse

        if (payload.sessions) {
            dispatch(setSessions(payload.sessions))
        }
    }
}

// Re-hydrate every account-backed view after the active session changes, so the whole dashboard
// reflects the newly selected session in one shot.
function reloadActiveSession(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        await Promise.all([
            dispatch(loadAccountSnapshot()),
            dispatch(loadTradingCalendar()),
            dispatch(loadHistory()),
        ])
    }
}

// POST a session action, refresh the session list, and reload the dashboard on success. Surfaces any
// server error (e.g. duplicate name) inline without switching sessions.
function mutateSession(action: 'create' | 'switch' | 'delete', name: string): AppThunk<Promise<void>> {
    return async (dispatch) => {
        const response = await fetch('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, name }),
        })
        const payload = (await response.json()) as SessionListResponse

        if (!response.ok || !payload.sessions) {
            dispatch(setSessionError(payload.error ?? 'Session action failed.'))
            return
        }

        dispatch(setSessions(payload.sessions))
        await dispatch(reloadActiveSession())
    }
}

// Create a new named session (and switch to it).
export function createSession(name: string): AppThunk<Promise<void>> {
    return mutateSession('create', name)
}

// Load / switch to an existing session: close the modal, jump to the Positions tab, and show a brief
// loading state while the new session's data replaces the old one — so only the new session's
// positions appear once loading clears.
export function switchSession(name: string): AppThunk<Promise<void>> {
    return async (dispatch) => {
        dispatch(closeSessionModal())
        dispatch(setActiveTab('positions'))
        dispatch(setSessionSwitching({ switching: true, to: name }))

        try {
            const response = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'switch', name }),
            })
            const payload = (await response.json()) as SessionListResponse

            if (!response.ok || !payload.sessions) {
                dispatch(setSessionError(payload.error ?? 'Session switch failed.'))
                return
            }

            dispatch(setSessions(payload.sessions))
            // Load the new session's data and hold the loading state for the minimum duration together.
            await Promise.all([dispatch(reloadActiveSession()), delay(SWITCH_LOADING_MS)])
        } finally {
            dispatch(setSessionSwitching({ switching: false }))
        }
    }
}

// Delete a session (the default session cannot be deleted).
export function deleteSession(name: string): AppThunk<Promise<void>> {
    return mutateSession('delete', name)
}

// Delete ALL sessions except the default, then reload the (now default) dashboard.
export function clearAllSessions(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        const response = await fetch('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clearAll' }),
        })
        const payload = (await response.json()) as SessionListResponse

        if (!response.ok || !payload.sessions) {
            dispatch(setSessionError(payload.error ?? 'Clear all failed.'))
            return
        }

        dispatch(setSessions(payload.sessions))
        await dispatch(reloadActiveSession())
    }
}

// Reset the CURRENT (active) session to the default starting state (POST /api/account inits the active
// session's folder). Like switching, it closes the modal, jumps to the Positions tab, and shows the
// brief loading state while the freshly reset session's data replaces the old view.
export function resetCurrentSession(): AppThunk<Promise<void>> {
    return async (dispatch, getState) => {
        const active = getState().session.active

        dispatch(closeSessionModal())
        dispatch(setActiveTab('positions'))
        dispatch(setSessionSwitching({ switching: true, to: active }))
        dispatch(setBusy(true))

        try {
            const response = await fetch('/api/account', { method: 'POST' })
            const payload = (await response.json()) as AccountResponse

            dispatch(setView(payload.view))
            dispatch(setStatus('Current session reset to the default starting state.'))
            // Refresh the account-backed views + session list, holding the loading state briefly.
            await Promise.all([
                dispatch(loadSessions()),
                dispatch(loadTradingCalendar()),
                dispatch(loadHistory()),
                delay(SWITCH_LOADING_MS),
            ])
        } finally {
            dispatch(setBusy(false))
            dispatch(setSessionSwitching({ switching: false }))
        }
    }
}
