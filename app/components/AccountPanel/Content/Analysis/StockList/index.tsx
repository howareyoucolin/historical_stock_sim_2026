'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../../store/hooks'
import { loadStockAnalysis } from '../actions'

// Render the left rail of available stock codes as small toggle buttons. Selecting one loads its
// analysis snapshot through the store; the active code stays highlighted.
export function StockList() {
    const dispatch = useAppDispatch()
    const stocks = useAppSelector((state) => state.analysis.availableStocks)
    const selectedStock = useAppSelector((state) => state.analysis.selectedStock)

    if (stocks.length === 0) {
        return <div className="stockList empty">No stocks available.</div>
    }

    return (
        <nav className="stockList" aria-label="Available stocks">
            {stocks.map((code) => (
                <button
                    key={code}
                    type="button"
                    aria-pressed={selectedStock === code}
                    className={`stockListButton ${selectedStock === code ? 'active' : ''}`}
                    onClick={() => dispatch(loadStockAnalysis(code))}
                >
                    {code}
                </button>
            ))}
        </nav>
    )
}
