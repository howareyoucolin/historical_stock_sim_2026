import type { AccountStockLotRow, AccountStockTableRow, AccountStockTableSummary, DefaultUserAccountSessionView } from './view-model'
import { fetchStockData, type MarketDataEntry, type StockDataFetcher } from '../stock/market-data-client'
import { readDefaultUserAccountSession, type AccountPosition, type AccountSessionDependencies, type AccountState, DEFAULT_USER_SESSION_RELATIVE_PATH } from './model'

type StockMarketEntry = MarketDataEntry

interface StockMarketPayload {
    historyByDate?: Record<string, StockMarketEntry>
}

interface ShowAccountSessionDependencies extends AccountSessionDependencies {
    // Fetches a stock's daily series from the market-data API; injectable for tests.
    getStockData?: StockDataFetcher
}

// Read the shared default user account session JSON for callers that need the raw account object.
export async function fetchDefaultUserAccountSession(
    dependencies: AccountSessionDependencies = {}
): Promise<AccountState> {
    return readDefaultUserAccountSession(dependencies)
}

// Fetch a stock's daily series from the market-data API (which carries the PE ratio used below).
async function readLocalStockMarketData(
    stockCode: string,
    { getStockData = fetchStockData }: ShowAccountSessionDependencies
): Promise<StockMarketPayload> {
    const payload = await getStockData(stockCode)

    if (payload === null) {
        throw new Error(`No market data found for ${stockCode}. It may not be a tradable symbol.`)
    }

    return payload
}

// Look up the saved closing price and PE ratio for a stock on the account's current simulation date.
interface MarketDataForDate {
    close: number
    peRatio: number | null
    previousClose: number | null
}

// Find the most recent close strictly before the given date, used for day-change figures.
function findPreviousClose(historyByDate: Record<string, StockMarketEntry>, accountDate: string): number | null {
    let previousDate: string | null = null

    for (const day of Object.keys(historyByDate)) {
        const close = historyByDate[day].close

        if (day < accountDate && close !== null && close !== undefined && (previousDate === null || day > previousDate)) {
            previousDate = day
        }
    }

    return previousDate === null ? null : (historyByDate[previousDate].close ?? null)
}

// Look up the close, PE ratio, and prior close for a stock on the account's current simulation date.
function getMarketDataForDate(stockCode: string, accountDate: string, payload: StockMarketPayload): MarketDataForDate {
    const historyByDate = payload.historyByDate ?? {}
    const entry = historyByDate[accountDate]

    if (!entry) {
        throw new Error(`No price data found for ${stockCode} on ${accountDate}.`)
    }

    if (entry.close === null || entry.close === undefined) {
        throw new Error(`Closing price for ${stockCode} on ${accountDate} is unavailable.`)
    }

    return { close: entry.close, peRatio: entry.peRatio ?? null, previousClose: findPreviousClose(historyByDate, accountDate) }
}

// Build the per-lot detail rows shown when a holding is expanded, oldest purchase first.
function buildAccountStockLotRows(positions: AccountPosition[], currentPrice: number): AccountStockLotRow[] {
    return [...positions]
        .sort((left, right) => left.purchase_date.localeCompare(right.purchase_date))
        .map((position) => {
            const totalCost = position.quantity * position.cost_per_share
            const marketValue = currentPrice * position.quantity
            const gainLoss = marketValue - totalCost

            return {
                purchaseDate: position.purchase_date,
                quantity: position.quantity,
                unitCost: position.cost_per_share,
                totalCost,
                marketValue,
                gainLoss,
                percentGainLoss: totalCost === 0 ? 0 : (gainLoss / totalCost) * 100,
            }
        })
}

// Aggregate all lots for a stock code into the single row shown in the holdings table.
function buildAccountStockTableRow(stockCode: string, positions: AccountPosition[], marketData: MarketDataForDate): AccountStockTableRow {
    const { close: currentPrice, peRatio, previousClose } = marketData
    const quantity = positions.reduce((total, position) => total + position.quantity, 0)
    const totalCostBasis = positions.reduce((total, position) => total + position.quantity * position.cost_per_share, 0)
    const averageCost = quantity === 0 ? 0 : totalCostBasis / quantity
    const totalValue = currentPrice * quantity
    const totalGainLoss = totalValue - totalCostBasis
    const percentGainLoss = totalCostBasis === 0 ? 0 : (totalGainLoss / totalCostBasis) * 100
    const priceChange = previousClose === null ? 0 : currentPrice - previousClose
    const priceChangePercent = previousClose === null || previousClose === 0 ? 0 : (priceChange / previousClose) * 100
    const purchaseDate = positions.reduce((earliest, position) => (position.purchase_date < earliest ? position.purchase_date : earliest), positions[0]?.purchase_date ?? '')

    return {
        stockCode,
        averageCost,
        currentPrice,
        priceChange,
        priceChangePercent,
        dayChangeValue: priceChange * quantity,
        peRatio,
        quantity,
        totalCostBasis,
        totalValue,
        totalGainLoss,
        percentGainLoss,
        purchaseDate,
        // Populated once every row is known so each position can be expressed as a share of the group.
        percentOfGroup: 0,
        lots: buildAccountStockLotRows(positions, currentPrice),
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
        const marketPayload = await readLocalStockMarketData(stockCode, dependencies)
        const marketData = getMarketDataForDate(stockCode, account.date, marketPayload)

        rows.push(buildAccountStockTableRow(stockCode, positions, marketData))
    }

    // Express each holding as a percentage of the group's total market value.
    const groupValue = rows.reduce((total, row) => total + row.totalValue, 0)

    for (const row of rows) {
        row.percentOfGroup = groupValue === 0 ? 0 : (row.totalValue / groupValue) * 100
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

// Format the PE ratio, showing a dash when earnings are unavailable (e.g. ETFs or unbuilt stocks).
function formatPeRatio(peRatio: number | null): string {
    return peRatio === null ? '-' : peRatio.toFixed(2)
}

// Aggregate the overall portfolio values shown above the stock table.
function buildAccountStockTableSummary(rows: AccountStockTableRow[]): AccountStockTableSummary {
    const summary = rows.reduce<AccountStockTableSummary>(
        (summary, row) => ({
            principal: summary.principal + row.totalCostBasis,
            totalCurrentValue: summary.totalCurrentValue + row.totalValue,
            totalGainLoss: summary.totalGainLoss + row.totalGainLoss,
            percentGainLoss: 0,
            totalDayChange: summary.totalDayChange + row.dayChangeValue,
            dayChangePercent: 0,
        }),
        {
            principal: 0,
            totalCurrentValue: 0,
            totalGainLoss: 0,
            percentGainLoss: 0,
            totalDayChange: 0,
            dayChangePercent: 0,
        }
    )

    // Day-change percent is measured against the prior day's value (current value minus the day's change).
    const previousValue = summary.totalCurrentValue - summary.totalDayChange

    return {
        ...summary,
        percentGainLoss: summary.principal === 0 ? 0 : (summary.totalGainLoss / summary.principal) * 100,
        dayChangePercent: previousValue === 0 ? 0 : (summary.totalDayChange / previousValue) * 100,
    }
}

// Build the reusable account holdings view used by both the CLI and browser UI.
export async function buildDefaultUserAccountSessionView(
    account: AccountState,
    dependencies: ShowAccountSessionDependencies = {}
): Promise<DefaultUserAccountSessionView> {
    const rows = await buildAccountStockTableRows(account, dependencies)

    return {
        account,
        rows,
        summary: buildAccountStockTableSummary(rows),
    }
}

// Read the shared account session and resolve the stock holdings view model for UI and CLI consumers.
export async function fetchDefaultUserAccountSessionView(
    dependencies: ShowAccountSessionDependencies = {}
): Promise<DefaultUserAccountSessionView> {
    const account = await fetchDefaultUserAccountSession(dependencies)

    return buildDefaultUserAccountSessionView(account, dependencies)
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
        'pe_ratio',
        'quantity',
        'total_value',
        'total_gain_loss',
        'percent_gain_loss',
    ]
    const dataRows = rows.map((row) => [
        row.stockCode,
        formatCurrency(row.averageCost),
        formatCurrency(row.currentPrice),
        formatPeRatio(row.peRatio),
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

// Format a resolved holdings view into the CLI table block, so callers that already hold the view
// (e.g. to also emit it as JSON) can render the human output without reading the session twice.
export function formatDefaultUserAccountSessionView({ account, rows, summary }: DefaultUserAccountSessionView): string {
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

// Build the CLI-friendly holdings view for the shared default user account session.
export async function showDefaultUserAccountSession(
    dependencies: ShowAccountSessionDependencies = {}
): Promise<string> {
    return formatDefaultUserAccountSessionView(await fetchDefaultUserAccountSessionView(dependencies))
}
