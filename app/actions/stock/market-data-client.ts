// Client for the stock market-data HTTP API served by the PHP site. This is the simulator's single
// source of price/EPS/dividend/corporate-action data; it replaces the old local market-data/*.json
// files. The base URL points at the PHP container (docker compose maps it to localhost:8700) and is
// overridable with MARKET_DATA_API_BASE for other environments.

const DEFAULT_API_BASE = 'http://localhost:8700'

type NullableNumber = number | null

// One day's record, matching the shape the old data.json carried so downstream consumers are unchanged.
export interface MarketDataEntry {
    close: NullableNumber
    volume?: number | null
    isPayoutDate: boolean
    dividendPerShare: number
    ttmEps: NullableNumber
    peRatio: NullableNumber
    sharesOutstanding?: NullableNumber
    marketCap?: NullableNumber
}

export interface StockDataPayload {
    stockCode: string
    range: { start: string; end: string }
    historyByDate: Record<string, MarketDataEntry>
}

// Source of a stock's daily series; defaults to fetchStockData but is injectable for tests.
export type StockDataFetcher = (stockCode: string) => Promise<StockDataPayload | null>

// Resolve the API base once per call so tests/processes can override it via the environment.
export function getMarketDataApiBase(): string {
    const base = process.env.MARKET_DATA_API_BASE?.trim()

    return (base && base.length > 0 ? base : DEFAULT_API_BASE).replace(/\/+$/, '')
}

// Fetch and JSON-parse an API path, turning non-2xx responses into clear errors. Returns null only
// for 404 so callers can treat "stock not found" distinctly from a transport/server failure.
async function fetchApi<T>(relativePath: string): Promise<T | null> {
    const url = `${getMarketDataApiBase()}${relativePath}`

    let response: Response

    try {
        response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    } catch (error) {
        throw new Error(`Could not reach the market-data API at ${url}: ${(error as Error).message}`)
    }

    if (response.status === 404) {
        return null
    }

    if (!response.ok) {
        throw new Error(`Market-data API request to ${url} failed with HTTP ${response.status}.`)
    }

    return (await response.json()) as T
}

// Fetch one stock's full daily series, or null when the symbol is unknown to the API.
export async function fetchStockData(stockCode: string): Promise<StockDataPayload | null> {
    return fetchApi<StockDataPayload>(`/api/stock-data.php?symbol=${encodeURIComponent(stockCode)}`)
}

// Fetch the market benchmark series (equal-weight S&P 500 index), or null if unavailable. Shaped
// like a stock's daily series so report building can value it the same way.
export async function fetchBenchmark(): Promise<StockDataPayload | null> {
    return fetchApi<StockDataPayload>(`/api/benchmark.php`)
}

// Fetch every tradable stock code (those with price history), sorted ascending.
export async function fetchStockCodes(): Promise<string[]> {
    const payload = await fetchApi<{ stocks?: string[] }>(`/api/stocks.php`)

    return payload?.stocks ?? []
}

// One stock's static profile (classification metadata) from the database. Non-time-series data,
// so no hindsight risk — this is the v2 source for company/segment info.
export interface StockProfilePayload {
    stockCode: string
    companyName: string | null
    sector: string | null
    industry: string | null
    description: string | null
}

// Fetch a stock's static profile, or null when the symbol is unknown.
export async function fetchStockInfo(stockCode: string): Promise<StockProfilePayload | null> {
    return fetchApi<StockProfilePayload>(`/api/stock-info.php?symbol=${encodeURIComponent(stockCode)}`)
}

// Fetch every stock code paired with its segment (DB sector), in one call — used for the listing /
// segment filter without an N+1 of per-stock profile lookups.
export async function fetchStockEntries(): Promise<Array<{ code: string; segment: string }>> {
    const payload = await fetchApi<{ entries?: Array<{ code: string; sector: string | null }> }>(`/api/stocks.php`)

    return (payload?.entries ?? []).map((entry) => ({ code: entry.code, segment: entry.sector ?? 'Unclassified' }))
}

// Fetch the NYSE trading calendar (ascending list of real market days).
export async function fetchTradingCalendar(): Promise<string[]> {
    const payload = await fetchApi<{ dates?: string[] }>(`/api/calendar.php`)

    return payload?.dates ?? []
}

// Fetch the raw corporate-action rows; parsing/validation stays in corporate-actions.ts.
export async function fetchCorporateActions(): Promise<unknown[]> {
    const payload = await fetchApi<{ actions?: unknown[] }>(`/api/corporate-actions.php`)

    return payload?.actions ?? []
}
