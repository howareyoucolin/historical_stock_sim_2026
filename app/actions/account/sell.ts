import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME, normalizeStockCode, validateStockCode } from '../stock/download-data'
import {
    readDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
    type AccountPosition,
    writeDefaultUserAccountSession,
} from './model'

interface StockHistoryPayload {
    historyByDate?: Record<string, { close?: number | null }>
}

export interface SellStockDependencies extends AccountSessionDependencies {
    readMarketDataFile?: (path: string, encoding: BufferEncoding) => Promise<string>
}

export interface SellStockResult {
    account: AccountState
    stockCode: string
    quantity: number
    pricePerShare: number
    totalProceeds: number
}

// Read the saved local price history for a stock code from the market-data directory.
async function readLocalStockHistory(
    stockCode: string,
    {
        cwd = process.cwd,
        readMarketDataFile = fs.readFile,
    }: SellStockDependencies
): Promise<StockHistoryPayload> {
    const historyFilePath = path.join(cwd(), DATA_DIRECTORY_NAME, stockCode, HISTORY_FILE_NAME)

    try {
        return JSON.parse(await readMarketDataFile(historyFilePath, 'utf8')) as StockHistoryPayload
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`No local history file found for ${stockCode}. Run \`stock download ${stockCode}\` first.`)
        }

        if (error instanceof SyntaxError) {
            throw new Error(`Invalid stock history JSON for ${stockCode}: ${error.message}`)
        }

        throw error
    }
}

// Look up the closing price used to sell a stock on the account's current simulation date.
function getSalePriceForDate(stockCode: string, accountDate: string, historyPayload: StockHistoryPayload): number {
    const historyEntry = historyPayload.historyByDate?.[accountDate]

    if (!historyEntry) {
        throw new Error(`No price data found for ${stockCode} on ${accountDate}.`)
    }

    if (historyEntry.close === null || historyEntry.close === undefined) {
        throw new Error(`Closing price for ${stockCode} on ${accountDate} is unavailable.`)
    }

    return historyEntry.close
}

// Reduce the held lots by the sold quantity, oldest first (FIFO), dropping any lot that is fully sold.
function reduceLotsFifo(lots: AccountPosition[], quantity: number): AccountPosition[] {
    let remaining = quantity
    const remainingLots: AccountPosition[] = []

    for (const lot of lots) {
        if (remaining === 0) {
            remainingLots.push(lot)
            continue
        }

        if (lot.quantity <= remaining) {
            remaining -= lot.quantity
            continue
        }

        remainingLots.push({ ...lot, quantity: lot.quantity - remaining })
        remaining = 0
    }

    return remainingLots
}

// Sell shares from the shared default account using the locally saved close price for the account date.
export async function sellStockInDefaultUserAccountSession(
    stockCode: string,
    quantity: number,
    dependencies: SellStockDependencies = {}
): Promise<SellStockResult> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('Quantity must be a positive integer.')
    }

    const normalizedStockCode = normalizeStockCode(stockCode)

    validateStockCode(normalizedStockCode)

    const account = await readDefaultUserAccountSession(dependencies)
    const lots = account.positions[normalizedStockCode] || []
    const ownedQuantity = lots.reduce((total, lot) => total + lot.quantity, 0)

    if (ownedQuantity < quantity) {
        throw new Error(`Not enough shares of ${normalizedStockCode} to sell ${quantity} (owned: ${ownedQuantity}).`)
    }

    const historyPayload = await readLocalStockHistory(normalizedStockCode, dependencies)
    const pricePerShare = getSalePriceForDate(normalizedStockCode, account.date, historyPayload)
    const totalProceeds = pricePerShare * quantity

    const remainingLots = reduceLotsFifo(lots, quantity)
    const updatedPositions = { ...account.positions }

    // Drop the holding entirely once its last shares are sold so the table stays clean.
    if (remainingLots.length > 0) {
        updatedPositions[normalizedStockCode] = remainingLots
    } else {
        delete updatedPositions[normalizedStockCode]
    }

    const updatedAccount: AccountState = {
        ...account,
        cash: account.cash + totalProceeds,
        positions: updatedPositions,
    }

    return {
        account: await writeDefaultUserAccountSession(updatedAccount, dependencies),
        stockCode: normalizedStockCode,
        quantity,
        pricePerShare,
        totalProceeds,
    }
}
