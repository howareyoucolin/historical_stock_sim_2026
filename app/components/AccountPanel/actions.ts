import type { AppThunk } from '../../store'
import { setHistoryEntries, setStatus, setTradingDates, setView, type AccountResponse } from '../../store/accountSlice'

// Load the current account snapshot from the shared API into the store on first render.
export function loadAccountSnapshot(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        const response = await fetch('/api/account', { cache: 'no-store' })
        const payload = (await response.json()) as AccountResponse

        dispatch(setView(payload.view))
        dispatch(setStatus('Loaded shared account session.'))
    }
}

// Load the trading calendar so the date picker can restrict to real market days.
export function loadTradingCalendar(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        const response = await fetch('/api/account/date', { cache: 'no-store' })
        const payload = (await response.json()) as { tradingDates?: string[] }

        if (payload.tradingDates) {
            dispatch(setTradingDates(payload.tradingDates))
        }
    }
}

// Background refresh used by the polling loop: fetch the account snapshot and history, then update
// the store only for the parts that actually changed. Returns true when anything was updated, so the
// poll-status indicator can distinguish "ui updated" from "nothing to update".
export function pollAccountData(): AppThunk<Promise<boolean>> {
    return async (dispatch, getState) => {
        const [accountResponse, historyResponse] = await Promise.all([
            fetch('/api/account', { cache: 'no-store' }),
            fetch('/api/account/history', { cache: 'no-store' }),
        ])
        const accountPayload = (await accountResponse.json()) as AccountResponse
        const historyPayload = (await historyResponse.json()) as { entries?: string[] }
        const nextEntries = historyPayload.entries ?? []

        const state = getState()
        let changed = false

        if (JSON.stringify(accountPayload.view) !== JSON.stringify(state.account.view)) {
            dispatch(setView(accountPayload.view))
            changed = true
        }

        if (JSON.stringify(nextEntries) !== JSON.stringify(state.account.historyEntries)) {
            dispatch(setHistoryEntries(nextEntries))
            changed = true
        }

        return changed
    }
}
