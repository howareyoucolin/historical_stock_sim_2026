import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

// One session as surfaced to the UI (mirrors the server SessionSummary shape).
export interface SessionSummary {
    name: string
    active: boolean
    date: string | null
    updatedAt: string | null
}

interface SessionSliceState {
    sessions: SessionSummary[]
    // The active session name (the one the browser currently views/trades).
    active: string
    // Last session-management error (e.g. duplicate name), shown inline and cleared on success.
    error: string | null
}

const initialState: SessionSliceState = {
    sessions: [],
    active: 'default',
    error: null,
}

const sessionSlice = createSlice({
    name: 'session',
    initialState,
    reducers: {
        // Replace the session list and derive the active name from it.
        setSessions(state, action: PayloadAction<SessionSummary[]>) {
            state.sessions = action.payload
            state.active = action.payload.find((session) => session.active)?.name ?? state.active
            state.error = null
        },
        setSessionError(state, action: PayloadAction<string | null>) {
            state.error = action.payload
        },
    },
})

export const { setSessions, setSessionError } = sessionSlice.actions
export default sessionSlice.reducer
