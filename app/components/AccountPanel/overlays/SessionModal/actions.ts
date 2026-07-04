import type { AppThunk } from '../../../../store'
import { setSessions, setSessionError, type SessionSummary } from '../../../../store/sessionSlice'
import { setBusy, setStatus, setView, type AccountResponse } from '../../../../store/accountSlice'
import { loadAccountSnapshot, loadTradingCalendar } from '../../actions'
import { loadHistory } from '../../Content/Histories/actions'

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

// Load / switch the active session to an existing one.
export function switchSession(name: string): AppThunk<Promise<void>> {
    return mutateSession('switch', name)
}

// Delete a session (the default session cannot be deleted).
export function deleteSession(name: string): AppThunk<Promise<void>> {
    return mutateSession('delete', name)
}

// Reset the CURRENT (active) session to the default starting state (POST /api/account inits the active
// session's folder), then refresh the account views and the session list (its date returns to start).
export function resetCurrentSession(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        dispatch(setBusy(true))

        try {
            const response = await fetch('/api/account', { method: 'POST' })
            const payload = (await response.json()) as AccountResponse

            dispatch(setView(payload.view))
            dispatch(setStatus('Current session reset to the default starting state.'))
            await Promise.all([dispatch(loadSessions()), dispatch(loadTradingCalendar()), dispatch(loadHistory())])
        } finally {
            dispatch(setBusy(false))
        }
    }
}
