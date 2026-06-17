import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_FILE_NAME } from './build-data'
import { DATA_DIRECTORY_NAME, pathExists } from './download-data'

export interface StockListDependencies {
    cwd?: () => string
    readDirectory?: (path: string) => Promise<string[]>
    fileExists?: (path: string) => Promise<boolean>
}

// Number of stock codes shown per row in the listing grid.
const COLUMNS_PER_ROW = 8

// Collect every stock code the app can actually use: a market-data subfolder that has a built
// data.json. Codes are returned alphabetically; a missing market-data directory yields none.
export async function buildStockList({
    cwd = process.cwd,
    readDirectory = fs.readdir,
    fileExists = pathExists,
}: StockListDependencies = {}): Promise<string[]> {
    const marketDataPath = path.join(cwd(), DATA_DIRECTORY_NAME)

    let entries: string[]

    try {
        entries = await readDirectory(marketDataPath)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return []
        }

        throw error
    }

    // Keep only entries that carry a built data.json; this also filters out stray files since a
    // file has no `<name>/data.json` child.
    const availability = await Promise.all(entries.map((entry) => fileExists(path.join(marketDataPath, entry, DATA_FILE_NAME))))

    return entries.filter((_entry, index) => availability[index]).sort()
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

// Build the CLI-friendly listing of every available stock code.
export async function showStockList(dependencies: StockListDependencies = {}): Promise<string> {
    const stockCodes = await buildStockList(dependencies)

    if (stockCodes.length === 0) {
        return 'No stocks available. Run `stock seed` to download the watchlist.'
    }

    return [`${stockCodes.length} stocks available:`, '', formatStockListGrid(stockCodes)].join('\n')
}
