import type { AppThunk } from '../../../../store'
import { setBusy, setStatus, setView, type AccountResponse } from '../../../../store/accountSlice'
import { clearTrade } from '../../../../store/formSlice'

// Fetch a stock's unit price as of the current simulation date for the trade preview. Returns null
// when the symbol is unknown or has no price yet, so the caller can show a "no price" hint. This is a
// read-only lookup feeding transient view state, so it returns the value instead of dispatching.
export async function fetchUnitPrice(symbol: string): Promise<number | null> {
    try {
        const response = await fetch(`/api/stock/analysis?code=${encodeURIComponent(symbol)}`, { cache: 'no-store' })

        if (!response.ok) {
            return null
        }

        const payload = (await response.json()) as { analysis?: { close?: number } }

        return payload.analysis?.close ?? null
    } catch {
        return null
    }
}

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
            dispatch(clearTrade())
        } finally {
            dispatch(setBusy(false))
        }
    }
}
