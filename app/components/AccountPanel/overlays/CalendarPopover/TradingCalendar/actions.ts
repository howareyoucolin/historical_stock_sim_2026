import type { AppThunk } from '../../../../../store'
import { closeCalendar } from '../../../../../store/uiSlice'
import { advanceDate } from '../../../Sidebar/TimeTravel/actions'

// Close the popover and fast-forward the simulation to the chosen trading day.
export function selectTradingDate(date: string): AppThunk<Promise<void>> {
    return async (dispatch) => {
        dispatch(closeCalendar())
        await dispatch(advanceDate({ action: 'set', date }))
    }
}
