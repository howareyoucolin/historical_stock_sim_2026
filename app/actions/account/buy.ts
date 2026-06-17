import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME, normalizeStockCode, validateStockCode } from '../stock/download-data'
import { appendHistoryEvent } from '../history/log'
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

export interface BuyStockDependencies extends AccountSessionDependencies {
    readMarketDataFile?: (path: string, encoding: BufferEncoding) => Promise<string>
}

export interface BuyStockResult {
    account: AccountState
    stockCode: string
    quantity: number
    costPerShare: number
    totalCost: number
}

// Read the saved local price history for a stock code from the market-data directory.
async function readLocalStockHistory(
    stockCode: string,
    {
        cwd = process.cwd,
        readMarketDataFile = fs.readFile,
    }: BuyStockDependencies
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

// Look up the closing price used to buy a stock on the account's current simulation date.
function getPurchasePriceForDate(stockCode: string, accountDate: string, historyPayload: StockHistoryPayload): number {
    const historyEntry = historyPayload.historyByDate?.[accountDate]

    if (!historyEntry) {
        throw new Error(`No price data found for ${stockCode} on ${accountDate}.`)
    }

    if (historyEntry.close === null || historyEntry.close === undefined) {
        throw new Error(`Closing price for ${stockCode} on ${accountDate} is unavailable.`)
    }

    return historyEntry.close
}

// Buy shares for the shared default account using the locally saved close price for the account date.
// An optional `note` is recorded on the BUY history row so an automation agent can annotate the trade.
export async function buyStockInDefaultUserAccountSession(
    stockCode: string,
    quantity: number,
    dependencies: BuyStockDependencies = {},
    note?: string
): Promise<BuyStockResult> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('Quantity must be a positive integer.')
    }

    const normalizedStockCode = normalizeStockCode(stockCode)

    validateStockCode(normalizedStockCode)

    const account = await readDefaultUserAccountSession(dependencies)
    const historyPayload = await readLocalStockHistory(normalizedStockCode, dependencies)
    const costPerShare = getPurchasePriceForDate(normalizedStockCode, account.date, historyPayload)
    const totalCost = costPerShare * quantity

    if (account.cash < totalCost) {
        throw new Error(`Not enough cash to buy ${quantity} shares of ${normalizedStockCode}.`)
    }

    const nextPosition: AccountPosition = {
        quantity,
        cost_per_share: costPerShare,
        purchase_date: account.date,
    }
    const updatedAccount: AccountState = {
        ...account,
        cash: account.cash - totalCost,
        positions: {
            ...account.positions,
            [normalizedStockCode]: [...(account.positions[normalizedStockCode] || []), nextPosition],
        },
    }

    const savedAccount = await writeDefaultUserAccountSession(updatedAccount, dependencies)

    await appendHistoryEvent(
        {
            type: 'BUY',
            simDate: account.date,
            stockCode: normalizedStockCode,
            quantity,
            pricePerShare: costPerShare,
            cashDelta: -totalCost,
            note,
        },
        { cwd: dependencies.cwd }
    )

    return {
        account: savedAccount,
        stockCode: normalizedStockCode,
        quantity,
        costPerShare,
        totalCost,
    }
}
