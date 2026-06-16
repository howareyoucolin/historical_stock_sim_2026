import type { AppThunk } from '../../store'
import { setStatus, setTradingDates, setView, type AccountResponse } from '../../store/accountSlice'

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
