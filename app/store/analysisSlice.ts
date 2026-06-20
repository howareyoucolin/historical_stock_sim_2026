import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import type { StockAnalysis } from '../actions/stock/analysis'
import type { StockInfo } from '../actions/stock/info'
import type { StockListEntry } from '../actions/stock/list'

interface AnalysisSliceState {
    availableStocks: StockListEntry[]
    selectedStock: string | null
    analysis: StockAnalysis | null
    stockInfo: StockInfo | null
    isLoading: boolean
    error: string | null
}

const initialState: AnalysisSliceState = {
    availableStocks: [],
    selectedStock: null,
    analysis: null,
    stockInfo: null,
    isLoading: false,
    error: null,
}

// Hold the analysis tab's shared state: the list of pickable stock codes, which one is selected,
// and the loaded snapshot for it. Kept in its own slice so the StockList and StockChart components
// read and update the selection through the store instead of prop-drilling.
const analysisSlice = createSlice({
    name: 'analysis',
    initialState,
    reducers: {
        setAvailableStocks(state, action: PayloadAction<string[]>) {
            state.availableStocks = action.payload.map((code) => ({ code, segment: 'Unclassified' }))
        },
        setAvailableStockEntries(state, action: PayloadAction<StockListEntry[]>) {
            state.availableStocks = action.payload
        },
        // Mark a stock as selected and clear the prior snapshot so the chart shows a loading state.
        selectStock(state, action: PayloadAction<string>) {
            state.selectedStock = action.payload
            state.analysis = null
            state.stockInfo = null
            state.error = null
            state.isLoading = true
        },
        setAnalysis(state, action: PayloadAction<{ analysis: StockAnalysis; stockInfo: StockInfo }>) {
            state.analysis = action.payload.analysis
            state.stockInfo = action.payload.stockInfo
            state.isLoading = false
            state.error = null
        },
        setAnalysisError(state, action: PayloadAction<string>) {
            state.analysis = null
            state.stockInfo = null
            state.isLoading = false
            state.error = action.payload
        },
    },
})

export const { setAvailableStocks, setAvailableStockEntries, selectStock, setAnalysis, setAnalysisError } = analysisSlice.actions
export default analysisSlice.reducer
