import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import { createEmptyDefaultUserAccountSessionView, type DefaultUserAccountSessionView } from '../actions/account/view-model'
import { createDefaultAccountState } from '../actions/account/state'
import type { DailyValueSnapshot } from '../actions/account/values-log'
import type { SimulationReport } from '../actions/report/build'

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
    valueSnapshots: DailyValueSnapshot[]
    report: SimulationReport | null
    reportError: string | null
}

const initialState: AccountSliceState = {
    view: createEmptyDefaultUserAccountSessionView(createDefaultAccountState()),
    status: 'Loading the shared account session...',
    isBusy: false,
    tradingDates: [],
    historyEntries: [],
    valueSnapshots: [],
    report: null,
    reportError: null,
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
        setValueSnapshots(state, action: PayloadAction<DailyValueSnapshot[]>) {
            state.valueSnapshots = action.payload
        },
        setReport(state, action: PayloadAction<SimulationReport | null>) {
            state.report = action.payload
            state.reportError = null
        },
        setReportError(state, action: PayloadAction<string | null>) {
            state.reportError = action.payload
        },
    },
})

export const { setView, setStatus, setBusy, setTradingDates, setHistoryEntries, setValueSnapshots, setReport, setReportError } = accountSlice.actions
export default accountSlice.reducer
