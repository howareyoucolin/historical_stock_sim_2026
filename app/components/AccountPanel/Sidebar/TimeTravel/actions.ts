import type { AppThunk } from '../../../../store'
import { setBusy, setStatus, setView, type AccountResponse } from '../../../../store/accountSlice'

type AdvanceDateRequest = { action: 'next' } | { action: 'set'; date: string }

// Advance the simulation date (one trading day, or forward to a chosen target) and refresh the
// view. Exported so the calendar popover can reuse it for "fast forward to a specific date".
export function advanceDate(requestBody: AdvanceDateRequest): AppThunk<Promise<void>> {
    return async (dispatch) => {
        dispatch(setBusy(true))

        try {
            const response = await fetch('/api/account/date', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            })
            const payload = (await response.json()) as AccountResponse

            if (!response.ok || payload.error) {
                dispatch(setStatus(payload.error ?? 'Date change failed.'))
                return
            }

            dispatch(setView(payload.view))
            dispatch(setStatus(payload.message ?? 'Date advanced.'))
        } finally {
            dispatch(setBusy(false))
        }
    }
}

// Step the simulation forward to the next market trading day.
export function advanceToNextDay(): AppThunk<Promise<void>> {
    return advanceDate({ action: 'next' })
}
