// Test helpers for the market-data API seams. The simulator used to read market-data/*.json files;
// it now fetches from the PHP API through injectable dependencies (getStockData, getTradingCalendar,
// getCorporateActions, getBenchmark, listStockCodes). These helpers build in-memory fakes for those
// seams so action tests stay file-free and fast.

import type { MarketDataEntry, StockDataPayload } from '../actions/stock/market-data-client'

// A loose per-day entry: only the fields a given test cares about need to be supplied; the rest
// default to the "no data" values the real API would still include.
export type PartialEntry = Partial<MarketDataEntry> & { close?: number | null }

// Fill a sparse per-day map into the full MarketDataEntry shape the API returns.
function toFullEntry(entry: PartialEntry): MarketDataEntry {
    return {
        close: entry.close ?? null,
        isPayoutDate: entry.isPayoutDate ?? false,
        dividendPerShare: entry.dividendPerShare ?? 0,
        ttmEps: entry.ttmEps ?? null,
        peRatio: entry.peRatio ?? null,
        sharesOutstanding: entry.sharesOutstanding ?? null,
        marketCap: entry.marketCap ?? null,
    }
}

// Build a single stock's API payload from a sparse history map.
export function makeStockData(stockCode: string, historyByDate: Record<string, PartialEntry>): StockDataPayload {
    const fullHistory: Record<string, MarketDataEntry> = {}
    for (const [date, entry] of Object.entries(historyByDate)) {
        fullHistory[date] = toFullEntry(entry)
    }

    const dates = Object.keys(fullHistory).sort()

    return {
        stockCode,
        range: { start: dates[0] ?? '', end: dates[dates.length - 1] ?? '' },
        historyByDate: fullHistory,
    }
}

// Build a getStockData fake from a map of stockCode -> sparse history. Unknown codes resolve to null,
// mirroring the API's 404-for-unknown-symbol behavior.
export function stockDataFetcher(
    byCode: Record<string, Record<string, PartialEntry>>
): (stockCode: string) => Promise<StockDataPayload | null> {
    return async (stockCode: string) => (byCode[stockCode] ? makeStockData(stockCode, byCode[stockCode]) : null)
}
