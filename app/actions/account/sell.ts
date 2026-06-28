import { normalizeStockCode, validateStockCode } from '../stock/download-data'
import { resolveCloseOnDate, type StockDataFetcher } from '../stock/price-lookup'
import { fetchStockData } from '../stock/market-data-client'
import { appendHistoryEvent } from '../history/log'
import { classifyHoldingTerm } from '../date/utils'
import {
    readDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
    type AccountPosition,
    writeDefaultUserAccountSession,
} from './model'

export interface SellStockDependencies extends AccountSessionDependencies {
    // Fetches a stock's daily series from the market-data API; injectable for tests.
    getStockData?: StockDataFetcher
}

export interface SellStockResult {
    account: AccountState
    stockCode: string
    quantity: number
    pricePerShare: number
    totalProceeds: number
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

    const { getStockData = fetchStockData } = dependencies
    const pricePerShare = await resolveCloseOnDate(normalizedStockCode, account.date, getStockData)
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
