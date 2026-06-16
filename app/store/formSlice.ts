import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface FormSliceState {
    symbol: string
    quantity: string
    depositAmount: string
}

const initialState: FormSliceState = {
    symbol: '',
    quantity: '',
    depositAmount: '',
}

// Hold the trade and deposit input values so form fields and the holdings "prefill" action can share
// them through the store rather than threading setters down the component tree.
const formSlice = createSlice({
    name: 'form',
    initialState,
    reducers: {
        setSymbol(state, action: PayloadAction<string>) {
            state.symbol = action.payload
        },
        setQuantity(state, action: PayloadAction<string>) {
            state.quantity = action.payload
        },
        setDepositAmount(state, action: PayloadAction<string>) {
            state.depositAmount = action.payload
        },
        prefillTrade(state, action: PayloadAction<{ symbol: string; quantity: string }>) {
            state.symbol = action.payload.symbol
            state.quantity = action.payload.quantity
        },
        clearQuantity(state) {
            state.quantity = ''
        },
        clearDepositAmount(state) {
            state.depositAmount = ''
        },
    },
})

export const { setSymbol, setQuantity, setDepositAmount, prefillTrade, clearQuantity, clearDepositAmount } = formSlice.actions
export default formSlice.reducer
