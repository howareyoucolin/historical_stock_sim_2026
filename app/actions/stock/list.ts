import { fetchStockCodes, fetchStockEntries } from './market-data-client'

export interface StockListDependencies {
    cwd?: () => string
    // Source of tradable stock codes; defaults to the market-data API. Injectable for tests.
    listStockCodes?: () => Promise<string[]>
    // Source of code+segment pairs (DB sector) in one call; injectable for tests.
    listStockEntries?: () => Promise<Array<{ code: string; segment: string }>>
}

export interface StockListEntry {
    code: string
    segment: string
}

// Number of stock codes shown per row in the listing grid.
const COLUMNS_PER_ROW = 8

// A tradable stock code uses only the characters the rest of the app accepts (see validateStockCode).
// Filtering here keeps a single malformed symbol from the data source out of the listing instead of
// failing the whole list.
const VALID_STOCK_CODE = /^[A-Z0-9.-]+$/

// Collect every stock code the app can actually trade (every symbol with price history in the
// market-data API), returned alphabetically. Malformed symbols are skipped.
export async function buildStockList({
    listStockCodes = fetchStockCodes,
}: StockListDependencies = {}): Promise<string[]> {
    return (await listStockCodes()).filter((code) => VALID_STOCK_CODE.test(code)).sort()
}

// Resolve every available stock code plus its segment (DB sector) so the UI can filter long lists.
// Segments come from one bulk call rather than a per-stock profile lookup. Malformed codes are skipped.
export async function buildStockListEntries({ listStockEntries = fetchStockEntries }: StockListDependencies = {}): Promise<StockListEntry[]> {
    return (await listStockEntries())
        .filter((entry) => VALID_STOCK_CODE.test(entry.code))
        .sort((left, right) => left.code.localeCompare(right.code))
        .map((entry) => ({ code: entry.code, segment: entry.segment }))
}

// Lay the stock codes out in a left-aligned grid so a long list stays scannable in the terminal.
function formatStockListGrid(stockCodes: string[]): string {
    const columnWidth = Math.max(...stockCodes.map((code) => code.length))
    const rows: string[] = []

    for (let index = 0; index < stockCodes.length; index += COLUMNS_PER_ROW) {
        const cells = stockCodes.slice(index, index + COLUMNS_PER_ROW)

        rows.push(cells.map((code) => code.padEnd(columnWidth)).join('  ').trimEnd())
    }

    return rows.join('\n')
}

// Format a resolved list of stock codes into the CLI grid, so callers holding the array (e.g. to
// also emit it as JSON) can render the human output without rebuilding it.
export function formatStockList(stockCodes: string[]): string {
    if (stockCodes.length === 0) {
        return 'No stocks available. Check that the market-data API/database is reachable.'
    }

    return [`${stockCodes.length} stocks available:`, '', formatStockListGrid(stockCodes)].join('\n')
}

// Build the CLI-friendly listing of every available stock code.
export async function showStockList(dependencies: StockListDependencies = {}): Promise<string> {
    return formatStockList(await buildStockList(dependencies))
}
