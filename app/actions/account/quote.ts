import { normalizeStockCode, validateStockCode } from '../stock/symbol'
import { resolveCloseOnDate, type StockDataFetcher } from '../stock/price-lookup'
import { fetchStockData } from '../stock/market-data-client'
import { readDefaultUserAccountSession, type AccountSessionDependencies } from './model'

export interface AccountDateQuoteDependencies extends AccountSessionDependencies {
    // Fetches a stock's daily series from the market-data API; injectable for tests.
    getStockData?: StockDataFetcher
}

// The closing price a trade would execute at: the stock's close on the account's current simulation
// date. This mirrors the price buy/sell use, so order sizing from a dollar amount stays consistent.
export interface AccountDateQuote {
    stockCode: string
    date: string
    close: number
}

// Resolve the close price for a stock on the account's current simulation date, throwing the same
// clear errors as buy/sell when the stock is unknown or the date is not a trading day.
export async function getStockQuoteForAccountDate(
    stockCode: string,
    dependencies: AccountDateQuoteDependencies = {}
): Promise<AccountDateQuote> {
    const { getStockData = fetchStockData } = dependencies
    const normalizedStockCode = normalizeStockCode(stockCode)

    validateStockCode(normalizedStockCode)

    const account = await readDefaultUserAccountSession(dependencies)
    const close = await resolveCloseOnDate(normalizedStockCode, account.date, getStockData)

    return { stockCode: normalizedStockCode, date: account.date, close }
}
