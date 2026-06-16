import type { AppThunk } from '../../../../store'
import { setHistoryEntries } from '../../../../store/accountSlice'

// Load the recorded account activity (buys, sells, dividends, deposits) into the store.
export function loadHistory(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        const response = await fetch('/api/account/history', { cache: 'no-store' })
        const payload = (await response.json()) as { entries?: string[] }

        dispatch(setHistoryEntries(payload.entries ?? []))
    }
}
