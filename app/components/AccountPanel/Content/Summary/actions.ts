import type { AppThunk } from '../../../../store'
import { setValueSnapshots } from '../../../../store/accountSlice'
import type { DailyValueSnapshot } from '../../../../actions/account/values-log'

// Load the recorded daily total-value series (cash + holdings) into the store for the summary graph.
export function loadValues(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        const response = await fetch('/api/account/values', { cache: 'no-store' })
        const payload = (await response.json()) as { snapshots?: DailyValueSnapshot[] }

        dispatch(setValueSnapshots(payload.snapshots ?? []))
    }
}
