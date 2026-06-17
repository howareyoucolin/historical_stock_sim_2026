'use client'

import { useEffect, useRef } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { loadAvailableStocks, loadStockAnalysis } from './actions'
import { StockList } from './StockList'
import { StockChart } from './StockChart'

// Render the Analysis tab: a left rail of stock-code buttons beside a main area that charts the
// selected stock and lists its figures as of the simulation date. The list and the selected stock's
// snapshot are reloaded each time the tab mounts so they reflect the latest simulated day.
export function Analysis() {
    const dispatch = useAppDispatch()
    const selectedStock = useAppSelector((state) => state.analysis.selectedStock)

    // A ref lets the mount-only effect refresh the existing selection without re-running when it changes.
    const selectedStockRef = useRef(selectedStock)
    selectedStockRef.current = selectedStock

    useEffect(() => {
        void dispatch(loadAvailableStocks())

        // Refresh the already-selected stock's snapshot so re-opening the tab reflects the current date.
        if (selectedStockRef.current !== null) {
            void dispatch(loadStockAnalysis(selectedStockRef.current))
        }
    }, [dispatch])

    return (
        <section className="analysis">
            <StockList />
            <div className="analysisMain">
                <StockChart />
            </div>
        </section>
    )
}
