'use client'

import { useId, useState } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../../store/hooks'
import { loadStockAnalysis } from '../actions'

// Render the left rail of available stock codes as small toggle buttons. Selecting one loads its
// analysis snapshot through the store; the active code stays highlighted.
export function StockList() {
    const dispatch = useAppDispatch()
    const stocks = useAppSelector((state) => state.analysis.availableStocks)
    const selectedStock = useAppSelector((state) => state.analysis.selectedStock)
    const [segmentFilter, setSegmentFilter] = useState('All segments')
    const [prefixFilter, setPrefixFilter] = useState('')
    const segmentFilterId = useId()
    const prefixFilterId = useId()

    const segments = ['All segments', ...new Set(stocks.map((stock) => stock.segment).sort((left, right) => left.localeCompare(right)))]
    const normalizedPrefix = prefixFilter.trim().toUpperCase()
    const filteredStocks = stocks.filter((stock) => {
        const matchesSegment = segmentFilter === 'All segments' || stock.segment === segmentFilter
        const matchesPrefix = normalizedPrefix === '' || stock.code.startsWith(normalizedPrefix)

        return matchesSegment && matchesPrefix
    })

    if (stocks.length === 0) {
        return <div className="stockList empty">No stocks available.</div>
    }

    return (
        <nav className="stockList" aria-label="Available stocks">
            <div className="stockListFilters">
                <label className="stockListField" htmlFor={segmentFilterId}>
                    <span className="stockListFieldLabel">Segment</span>
                    <select
                        id={segmentFilterId}
                        className="stockListSelect"
                        value={segmentFilter}
                        onChange={(event) => setSegmentFilter(event.target.value)}
                    >
                        {segments.map((segment) => (
                            <option key={segment} value={segment}>
                                {segment}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="stockListField" htmlFor={prefixFilterId}>
                    <span className="stockListFieldLabel">Ticker prefix</span>
                    <input
                        id={prefixFilterId}
                        className="stockListInput"
                        type="text"
                        inputMode="text"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        value={prefixFilter}
                        onChange={(event) => setPrefixFilter(event.target.value.toUpperCase())}
                    />
                </label>
            </div>

            <div className="stockListSummary">{filteredStocks.length} of {stocks.length} stocks</div>

            <div className="stockListButtons">
                {filteredStocks.length === 0 ? (
                    <div className="stockListNoMatches">No stocks match those filters.</div>
                ) : (
                    filteredStocks.map((stock) => (
                        <button
                            key={stock.code}
                            type="button"
                            aria-pressed={selectedStock === stock.code}
                            className={`stockListButton ${selectedStock === stock.code ? 'active' : ''}`}
                            onClick={() => dispatch(loadStockAnalysis(stock.code))}
                            title={`${stock.code} • ${stock.segment}`}
                        >
                            {stock.code}
                        </button>
                    ))
                )}
            </div>
        </nav>
    )
}
