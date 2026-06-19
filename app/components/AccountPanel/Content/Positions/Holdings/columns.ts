import type { ReactNode } from 'react'
import { money, percent, signedMoney, signedPercent, tone } from '../../../../shared/format'
import type { AccountStockTableRow } from '../../../../../actions/account/view-model'

// Keys for every toggleable data column in the holdings table. The expand and
// Symbol columns are structural (they toggle lots and prefill the trade form),
// so they are always rendered and are not listed here.
export type HoldingsColumnKey =
    | 'quantity'
    | 'currentPrice'
    | 'priceChange'
    | 'priceChangePercent'
    | 'totalValue'
    | 'dayChangeValue'
    | 'averageCost'
    | 'totalCostBasis'
    | 'totalGainLoss'
    | 'percentGainLoss'
    | 'percentOfGroup'

// Descriptor for one data column: its header label, how to render a cell from a
// row, and an optional per-cell class used for gain/loss tone coloring.
export interface HoldingsColumn {
    key: HoldingsColumnKey
    header: string
    render: (row: AccountStockTableRow) => ReactNode
    cellClassName?: (row: AccountStockTableRow) => string
}

// Full set of data columns in display order. This defines what a column is and
// how it renders; use HOLDINGS_COLUMN_VISIBILITY below to choose which ones show.
export const HOLDINGS_COLUMNS: HoldingsColumn[] = [
    { key: 'quantity', header: 'Quantity', render: (row) => row.quantity },
    { key: 'currentPrice', header: 'Last Price', render: (row) => money(row.currentPrice) },
    { key: 'priceChange', header: '$ Chg', render: (row) => signedMoney(row.priceChange), cellClassName: (row) => tone(row.priceChange) },
    { key: 'priceChangePercent', header: '% Chg', render: (row) => signedPercent(row.priceChangePercent), cellClassName: (row) => tone(row.priceChange) },
    { key: 'totalValue', header: 'Market Value', render: (row) => money(row.totalValue) },
    { key: 'dayChangeValue', header: 'Day Chg $', render: (row) => signedMoney(row.dayChangeValue), cellClassName: (row) => tone(row.dayChangeValue) },
    { key: 'averageCost', header: 'Unit Cost', render: (row) => money(row.averageCost) },
    { key: 'totalCostBasis', header: 'Total Cost', render: (row) => money(row.totalCostBasis) },
    { key: 'totalGainLoss', header: '$ Gain/Loss', render: (row) => signedMoney(row.totalGainLoss), cellClassName: (row) => tone(row.totalGainLoss) },
    { key: 'percentGainLoss', header: '% Gain/Loss', render: (row) => signedPercent(row.percentGainLoss), cellClassName: (row) => tone(row.totalGainLoss) },
    { key: 'percentOfGroup', header: '% of Group', render: (row) => percent(row.percentOfGroup) },
]

// ── Column visibility config ────────────────────────────────────────────────
// Set a value to false to hide that column in the holdings table.
export const HOLDINGS_COLUMN_VISIBILITY: Record<HoldingsColumnKey, boolean> = {
    quantity: true,
    currentPrice: true,
    priceChange: false,
    priceChangePercent: false,
    totalValue: true,
    dayChangeValue: false,
    averageCost: true,
    totalCostBasis: true,
    totalGainLoss: true,
    percentGainLoss: true,
    percentOfGroup: true,
}

// Resolve the columns to actually render, in display order, honoring the
// visibility config above.
export function getVisibleHoldingsColumns(): HoldingsColumn[] {
    return HOLDINGS_COLUMNS.filter((column) => HOLDINGS_COLUMN_VISIBILITY[column.key])
}
