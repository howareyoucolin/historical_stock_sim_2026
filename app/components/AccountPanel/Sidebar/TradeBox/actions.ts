import type { AppThunk } from '../../../../store'
import { setBusy, setStatus, setView, type AccountResponse } from '../../../../store/accountSlice'
import { clearQuantity } from '../../../../store/formSlice'

// Submit a buy or sell order for the symbol and quantity currently held in the form slice, then
// refresh the account view and status from the API response.
export function submitTrade(action: 'buy' | 'sell'): AppThunk<Promise<void>> {
    return async (dispatch, getState) => {
        const { symbol, quantity } = getState().form
        const normalizedSymbol = symbol.trim().toUpperCase()
        const parsedQuantity = Number(quantity)

        if (normalizedSymbol === '') {
            dispatch(setStatus('Enter a stock symbol to trade.'))
            return
        }

        if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
            dispatch(setStatus('Quantity must be a positive whole number.'))
            return
        }

        dispatch(setBusy(true))

        try {
            const response = await fetch('/api/account/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, stockCode: normalizedSymbol, quantity: parsedQuantity }),
            })
            const payload = (await response.json()) as AccountResponse

            if (!response.ok || payload.error) {
                dispatch(setStatus(payload.error ?? 'Trade failed.'))
                return
            }

            dispatch(setView(payload.view))
            dispatch(setStatus(payload.message ?? 'Trade complete.'))
            dispatch(clearQuantity())
        } finally {
            dispatch(setBusy(false))
        }
    }
}
