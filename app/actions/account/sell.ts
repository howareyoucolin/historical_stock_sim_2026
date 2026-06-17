import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME, normalizeStockCode, validateStockCode } from '../stock/download-data'
import { appendHistoryEvent } from '../history/log'
import { classifyHoldingTerm } from '../date/utils'
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

// A portion of a single purchase batch consumed by a sale, kept separate per lot so each batch
// can be recorded on its own history row with its own holding term.
interface ConsumedLot {
    quantity: number
    purchaseDate: string
}

// Consume the sold quantity from held lots oldest first (FIFO), returning both the per-batch
// portions sold and the lots that remain (with any partially sold lot reduced in place).
function consumeLotsFifo(lots: AccountPosition[], quantity: number): { consumed: ConsumedLot[]; remaining: AccountPosition[] } {
    let remaining = quantity
    const consumed: ConsumedLot[] = []
    const remainingLots: AccountPosition[] = []

    for (const lot of lots) {
        if (remaining === 0) {
            remainingLots.push(lot)
            continue
        }

        if (lot.quantity <= remaining) {
            consumed.push({ quantity: lot.quantity, purchaseDate: lot.purchase_date })
            remaining -= lot.quantity
            continue
        }

        consumed.push({ quantity: remaining, purchaseDate: lot.purchase_date })
        remainingLots.push({ ...lot, quantity: lot.quantity - remaining })
        remaining = 0
    }

    return { consumed, remaining: remainingLots }
}

// Sell shares from the shared default account using the locally saved close price for the account date.
// An optional `note` is recorded on every SELL history row so an automation agent can annotate the trade.
export async function sellStockInDefaultUserAccountSession(
    stockCode: string,
    quantity: number,
    dependencies: SellStockDependencies = {},
    note?: string
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

    const { consumed, remaining: remainingLots } = consumeLotsFifo(lots, quantity)
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

    const savedAccount = await writeDefaultUserAccountSession(updatedAccount, dependencies)

    // Record one history row per purchase batch sold, tagging each with its short/long holding term.
    for (const lot of consumed) {
        await appendHistoryEvent(
            {
                type: 'SELL',
                simDate: account.date,
                stockCode: normalizedStockCode,
                quantity: lot.quantity,
                pricePerShare,
                acquiredDate: lot.purchaseDate,
                term: classifyHoldingTerm(lot.purchaseDate, account.date),
                cashDelta: pricePerShare * lot.quantity,
                note,
            },
            { cwd: dependencies.cwd }
        )
    }

    return {
        account: savedAccount,
        stockCode: normalizedStockCode,
        quantity,
        pricePerShare,
        totalProceeds,
    }
}
