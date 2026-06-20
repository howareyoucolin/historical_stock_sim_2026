import type { AppThunk } from '../../../../store'
import { selectStock, setAnalysis, setAnalysisError, setAvailableStockEntries, setAvailableStocks } from '../../../../store/analysisSlice'
import type { StockAnalysis } from '../../../../actions/stock/analysis'
import type { StockInfo } from '../../../../actions/stock/info'
import type { StockListEntry } from '../../../../actions/stock/list'

// Load the list of available stock codes for the picker, selecting the first one so the chart is
// never empty on first open.
export function loadAvailableStocks(): AppThunk<Promise<void>> {
    return async (dispatch, getState) => {
        const response = await fetch('/api/stock/list', { cache: 'no-store' })
        const payload = (await response.json()) as { stocks?: string[]; entries?: StockListEntry[] }
        const stocks = payload.stocks ?? []
        const entries = payload.entries ?? []

        if (entries.length > 0) {
            dispatch(setAvailableStockEntries(entries))
        } else {
            dispatch(setAvailableStocks(stocks))
        }

        // Auto-select the first stock only when nothing is selected yet, so re-opening the tab keeps
        // the user's current pick.
        if (stocks.length > 0 && getState().analysis.selectedStock === null) {
            await dispatch(loadStockAnalysis(stocks[0]))
        }
    }
}

// Select a stock and load its analysis snapshot for the current simulation date into the store.
export function loadStockAnalysis(stockCode: string): AppThunk<Promise<void>> {
    return async (dispatch) => {
        dispatch(selectStock(stockCode))

        try {
            const response = await fetch(`/api/stock/analysis?code=${encodeURIComponent(stockCode)}`, { cache: 'no-store' })
            const payload = (await response.json()) as { analysis?: StockAnalysis; info?: StockInfo; error?: string }

            if (!response.ok || !payload.analysis || !payload.info) {
                dispatch(setAnalysisError(payload.error ?? `Could not load data for ${stockCode}.`))
                return
            }

            dispatch(setAnalysis({ analysis: payload.analysis, stockInfo: payload.info }))
        } catch (error) {
            dispatch(setAnalysisError(error instanceof Error ? error.message : String(error)))
        }
    }
}
