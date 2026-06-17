import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME, normalizeStockCode, validateStockCode } from '../stock/download-data'
import { readDefaultUserAccountSession, type AccountSessionDependencies } from './model'

interface StockHistoryPayload {
    historyByDate?: Record<string, { close?: number | null }>
}

export interface AccountDateQuoteDependencies extends AccountSessionDependencies {
    readMarketDataFile?: (path: string, encoding: BufferEncoding) => Promise<string>
}

// The closing price a trade would execute at: the stock's close on the account's current simulation
// date. This mirrors the price buy/sell use, so order sizing from a dollar amount stays consistent.
export interface AccountDateQuote {
    stockCode: string
    date: string
    close: number
}

// Resolve the close price for a stock on the account's current simulation date, throwing the same
// clear errors as buy/sell when the stock is not downloaded or the date is not a trading day.
export async function getStockQuoteForAccountDate(
    stockCode: string,
    dependencies: AccountDateQuoteDependencies = {}
): Promise<AccountDateQuote> {
    const { cwd = process.cwd, readMarketDataFile = fs.readFile } = dependencies
    const normalizedStockCode = normalizeStockCode(stockCode)

    validateStockCode(normalizedStockCode)

    const account = await readDefaultUserAccountSession(dependencies)
    const historyFilePath = path.join(cwd(), DATA_DIRECTORY_NAME, normalizedStockCode, HISTORY_FILE_NAME)

    let payload: StockHistoryPayload

    try {
        payload = JSON.parse(await readMarketDataFile(historyFilePath, 'utf8')) as StockHistoryPayload
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`No local history file found for ${normalizedStockCode}. Run \`stock download ${normalizedStockCode}\` first.`)
        }

        if (error instanceof SyntaxError) {
            throw new Error(`Invalid stock history JSON for ${normalizedStockCode}: ${error.message}`)
        }

        throw error
    }

    const entry = payload.historyByDate?.[account.date]

    if (!entry) {
        throw new Error(`No price data found for ${normalizedStockCode} on ${account.date}.`)
    }

    if (entry.close === null || entry.close === undefined) {
        throw new Error(`Closing price for ${normalizedStockCode} on ${account.date} is unavailable.`)
    }

    return { stockCode: normalizedStockCode, date: account.date, close: entry.close }
}
