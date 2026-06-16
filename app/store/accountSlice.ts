import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import { createEmptyDefaultUserAccountSessionView, type DefaultUserAccountSessionView } from '../actions/account/view-model'
import { createDefaultAccountState } from '../actions/account/state'

// Shared shape returned by every account-mutating API route, surfaced to thunks for refreshing state.
export interface AccountResponse {
    view: DefaultUserAccountSessionView
    sessionFile: string
    message?: string
    error?: string
}

interface AccountSliceState {
    view: DefaultUserAccountSessionView
    status: string
    isBusy: boolean
    tradingDates: string[]
    historyEntries: string[]
}

const initialState: AccountSliceState = {
    view: createEmptyDefaultUserAccountSessionView(createDefaultAccountState()),
    status: 'Loading the shared account session...',
    isBusy: false,
    tradingDates: [],
    historyEntries: [],
}

// Hold the server-owned account snapshot plus the transient busy/status flags the UI reacts to.
const accountSlice = createSlice({
    name: 'account',
    initialState,
    reducers: {
        setView(state, action: PayloadAction<DefaultUserAccountSessionView>) {
            state.view = action.payload
        },
        setStatus(state, action: PayloadAction<string>) {
            state.status = action.payload
        },
        setBusy(state, action: PayloadAction<boolean>) {
            state.isBusy = action.payload
        },
        setTradingDates(state, action: PayloadAction<string[]>) {
            state.tradingDates = action.payload
        },
        setHistoryEntries(state, action: PayloadAction<string[]>) {
            state.historyEntries = action.payload
        },
    },
})

export const { setView, setStatus, setBusy, setTradingDates, setHistoryEntries } = accountSlice.actions
export default accountSlice.reducer
