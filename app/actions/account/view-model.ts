import type { AccountState } from './state'

export interface AccountStockTableRow {
    stockCode: string
    averageCost: number
    currentPrice: number
    priceChange: number
    priceChangePercent: number
    dayChangeValue: number
    peRatio: number | null
    quantity: number
    totalCostBasis: number
    totalValue: number
    totalGainLoss: number
    percentGainLoss: number
    purchaseDate: string
    percentOfGroup: number
}

export interface AccountStockTableSummary {
    principal: number
    totalCurrentValue: number
    totalGainLoss: number
    percentGainLoss: number
    totalDayChange: number
    dayChangePercent: number
}

export interface DefaultUserAccountSessionView {
    account: AccountState
    rows: AccountStockTableRow[]
    summary: AccountStockTableSummary
}

// Build an empty holdings summary so browser state can initialize before the first API response lands.
export function createEmptyAccountStockTableSummary(): AccountStockTableSummary {
    return {
        principal: 0,
        totalCurrentValue: 0,
        totalGainLoss: 0,
        percentGainLoss: 0,
        totalDayChange: 0,
        dayChangePercent: 0,
    }
}

// Build an empty account view that mirrors the API shape used by the browser UI.
export function createEmptyDefaultUserAccountSessionView(account: AccountState): DefaultUserAccountSessionView {
    return {
        account,
        rows: [],
        summary: createEmptyAccountStockTableSummary(),
    }
}
