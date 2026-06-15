import type { AccountState } from './state'

export interface AccountStockTableRow {
    stockCode: string
    averageCost: number
    currentPrice: number
    quantity: number
    totalCostBasis: number
    totalValue: number
    totalGainLoss: number
    percentGainLoss: number
}

export interface AccountStockTableSummary {
    principal: number
    totalCurrentValue: number
    totalGainLoss: number
    percentGainLoss: number
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
