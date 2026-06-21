import type { SimulationReport } from '../../../../actions/report/build'
import type { AppThunk } from '../../../../store'
import { setReport, setReportError } from '../../../../store/accountSlice'

// Load the saved report JSON into the store for the report tab, surfacing a friendly error on failure.
export function loadReport(): AppThunk<Promise<void>> {
    return async (dispatch) => {
        try {
            const response = await fetch('/api/account/report', { cache: 'no-store' })
            const payload = (await response.json()) as { report?: SimulationReport | null; error?: string }

            if (!response.ok) {
                dispatch(setReport(null))
                dispatch(setReportError(payload.error ?? 'Could not load the saved report.'))
                return
            }

            dispatch(setReport(payload.report ?? null))
        } catch (error) {
            dispatch(setReport(null))
            dispatch(setReportError(error instanceof Error ? error.message : String(error)))
        }
    }
}
