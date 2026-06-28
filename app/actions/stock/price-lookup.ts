import { fetchStockData, type StockDataFetcher } from './market-data-client'

export type { StockDataFetcher }

// Resolve the closing price a trade executes at: the stock's close on the given simulation date.
// Shared by buy, sell, and quote so order pricing stays identical across them, with consistent
// errors when the stock is unknown to the API or the date is not a trading day.
export async function resolveCloseOnDate(
    stockCode: string,
    date: string,
    getStockData: StockDataFetcher = fetchStockData
): Promise<number> {
    const payload = await getStockData(stockCode)

    if (payload === null) {
        throw new Error(`No market data found for ${stockCode}. It may not be a tradable symbol.`)
    }

    const entry = payload.historyByDate?.[date]

    if (!entry) {
        throw new Error(`No price data found for ${stockCode} on ${date}.`)
    }

    if (entry.close === null || entry.close === undefined) {
        throw new Error(`Closing price for ${stockCode} on ${date} is unavailable.`)
    }

    return entry.close
}
