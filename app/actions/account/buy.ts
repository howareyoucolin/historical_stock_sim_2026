import { normalizeStockCode, validateStockCode } from '../stock/download-data'
import { resolveCloseOnDate, type StockDataFetcher } from '../stock/price-lookup'
import { fetchStockData } from '../stock/market-data-client'
import { appendHistoryEvent } from '../history/log'
import {
    readDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
    type AccountPosition,
    writeDefaultUserAccountSession,
} from './model'

export interface BuyStockDependencies extends AccountSessionDependencies {
    // Fetches a stock's daily series from the market-data API; injectable for tests.
    getStockData?: StockDataFetcher
}

export interface BuyStockResult {
    account: AccountState
    stockCode: string
    quantity: number
    costPerShare: number
    totalCost: number
}

// Buy shares for the shared default account using the API close price for the account date.
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

    const { getStockData = fetchStockData } = dependencies
    const account = await readDefaultUserAccountSession(dependencies)
    const costPerShare = await resolveCloseOnDate(normalizedStockCode, account.date, getStockData)
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
