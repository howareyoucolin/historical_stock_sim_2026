import type { AppThunk } from '../../../../store'
import { setBusy, setStatus, setView, type AccountResponse } from '../../../../store/accountSlice'

// Reset the shared account session file to the default simulation shape and refresh the view.
export function resetAccount(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        dispatch(setBusy(true))

        try {
            const response = await fetch('/api/account', { method: 'POST' })
            const payload = (await response.json()) as AccountResponse

            dispatch(setView(payload.view))
            dispatch(setStatus('Account reset to the default starting state.'))
        } finally {
            dispatch(setBusy(false))
        }
    }
}
