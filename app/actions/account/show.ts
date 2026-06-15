import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME } from '../stock/download-data'
import { readDefaultUserAccountSession, type AccountPosition, type AccountSessionDependencies, type AccountState, DEFAULT_USER_SESSION_RELATIVE_PATH } from './model'

interface StockHistoryPayload {
    historyByDate?: Record<string, { close?: number | null }>
}

interface ShowAccountSessionDependencies extends AccountSessionDependencies {
    readMarketDataFile?: (path: string, encoding: BufferEncoding) => Promise<string>
}

interface AccountStockTableRow {
    stockCode: string
    averageCost: number
    currentPrice: number
    quantity: number
    totalCostBasis: number
    totalValue: number
    totalGainLoss: number
    percentGainLoss: number
}

interface AccountStockTableSummary {
    principal: number
    totalCurrentValue: number
    totalGainLoss: number
    percentGainLoss: number
}

// Read the shared default user account session JSON for callers that need the raw account object.
export async function fetchDefaultUserAccountSession(
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    return readDefaultUserAccountSession(dependencies)
}

// Read the saved local price history for a stock code so the CLI can value the current holdings table.
async function readLocalStockHistory(
    stockCode: string,
    {
        cwd = process.cwd,
        readMarketDataFile = fs.readFile,
    }: ShowAccountSessionDependencies
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

// Look up the saved closing price for a stock on the account's current simulation date.
function getCurrentPriceForDate(stockCode: string, accountDate: string, historyPayload: StockHistoryPayload): number {
    const historyEntry = historyPayload.historyByDate?.[accountDate]

    if (!historyEntry) {
        throw new Error(`No price data found for ${stockCode} on ${accountDate}.`)
    }

    if (historyEntry.close === null || historyEntry.close === undefined) {
        throw new Error(`Closing price for ${stockCode} on ${accountDate} is unavailable.`)
    }

    return historyEntry.close
}

// Aggregate all lots for a stock code into the single row shown in the CLI holdings table.
function buildAccountStockTableRow(stockCode: string, positions: AccountPosition[], currentPrice: number): AccountStockTableRow {
    const quantity = positions.reduce((total, position) => total + position.quantity, 0)
    const totalCostBasis = positions.reduce((total, position) => total + position.quantity * position.cost_per_share, 0)
    const averageCost = quantity === 0 ? 0 : totalCostBasis / quantity
    const totalValue = currentPrice * quantity
    const totalGainLoss = totalValue - totalCostBasis
    const percentGainLoss = totalCostBasis === 0 ? 0 : (totalGainLoss / totalCostBasis) * 100

    return {
        stockCode,
        averageCost,
        currentPrice,
        quantity,
        totalCostBasis,
        totalValue,
        totalGainLoss,
        percentGainLoss,
    }
}

// Build the per-stock holdings rows used by the account show table in the CLI.
async function buildAccountStockTableRows(
    account: AccountState,
    dependencies: ShowAccountSessionDependencies
): Promise<AccountStockTableRow[]> {
    const stockEntries = Object.entries(account.positions)
        .filter(([, positions]) => positions.length > 0)
        .sort(([leftStockCode], [rightStockCode]) => leftStockCode.localeCompare(rightStockCode))

    const rows: AccountStockTableRow[] = []

    for (const [stockCode, positions] of stockEntries) {
        const historyPayload = await readLocalStockHistory(stockCode, dependencies)
        const currentPrice = getCurrentPriceForDate(stockCode, account.date, historyPayload)

        rows.push(buildAccountStockTableRow(stockCode, positions, currentPrice))
    }

    return rows
}

// Format a currency value for the stock table and account summary lines.
function formatCurrency(value: number): string {
    return value.toFixed(2)
}

// Format a percentage value for the stock table.
function formatPercent(value: number): string {
    return `${value.toFixed(2)}%`
}

// Aggregate the overall portfolio values shown above the stock table.
function buildAccountStockTableSummary(rows: AccountStockTableRow[]): AccountStockTableSummary {
    const summary = rows.reduce<AccountStockTableSummary>(
        (summary, row) => ({
            principal: summary.principal + row.totalCostBasis,
            totalCurrentValue: summary.totalCurrentValue + row.totalValue,
            totalGainLoss: summary.totalGainLoss + row.totalGainLoss,
            percentGainLoss: 0,
        }),
        {
            principal: 0,
            totalCurrentValue: 0,
            totalGainLoss: 0,
            percentGainLoss: 0,
        }
    )

    return {
        ...summary,
        percentGainLoss: summary.principal === 0 ? 0 : (summary.totalGainLoss / summary.principal) * 100,
    }
}

// Format the one-line portfolio rollup that sits between cash and the holdings table.
function formatAccountStockTableSummary(summary: AccountStockTableSummary): string {
    return [
        `Basis: ${formatCurrency(summary.principal)}`,
        `Value: ${formatCurrency(summary.totalCurrentValue)}`,
        `P/L: ${formatCurrency(summary.totalGainLoss)}`,
        `P/L%: ${formatPercent(summary.percentGainLoss)}`,
    ].join(' | ')
}

// Render a padded table row so stock metrics stay aligned in plain-text terminals.
function formatTableRow(cells: string[], widths: number[]): string {
    return cells
        .map((cell, index) => (index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index])))
        .join(' | ')
}

// Render the ASCII separator that sits between the table header and the data rows.
function formatTableSeparator(widths: number[]): string {
    return widths.map((width) => '-'.repeat(width)).join('-+-')
}

// Build the stock holdings table shown by the CLI account show command.
function formatAccountStockTable(rows: AccountStockTableRow[]): string {
    const header = [
        'stock_code',
        'average_cost',
        'current_price',
        'quantity',
        'total_value',
        'total_gain_loss',
        'percent_gain_loss',
    ]
    const dataRows = rows.map((row) => [
        row.stockCode,
        formatCurrency(row.averageCost),
        formatCurrency(row.currentPrice),
        `${row.quantity}`,
        formatCurrency(row.totalValue),
        formatCurrency(row.totalGainLoss),
        formatPercent(row.percentGainLoss),
    ])
    const widths = header.map((heading, index) =>
        Math.max(
            heading.length,
            ...dataRows.map((row) => row[index].length)
        )
    )

    return [formatTableRow(header, widths), formatTableSeparator(widths), ...dataRows.map((row) => formatTableRow(row, widths))].join('\n')
}

// Build the CLI-friendly holdings view for the shared default user account session.
export async function showDefaultUserAccountSession(
    dependencies: ShowAccountSessionDependencies = {}
): Promise<string> {
    const account = await fetchDefaultUserAccountSession(dependencies)
    const rows = await buildAccountStockTableRows(account, dependencies)
    const summary = buildAccountStockTableSummary(rows)

    if (rows.length === 0) {
        return [
            `Date: ${account.date}`,
            `Cash: ${formatCurrency(account.cash)}`,
            formatAccountStockTableSummary(summary),
            '',
            `No tracked stocks found in ${DEFAULT_USER_SESSION_RELATIVE_PATH}.`,
        ].join('\n')
    }

    return [
        `Date: ${account.date}`,
        `Cash: ${formatCurrency(account.cash)}`,
        formatAccountStockTableSummary(summary),
        '',
        formatAccountStockTable(rows),
    ].join('\n')
}
