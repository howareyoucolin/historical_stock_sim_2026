import fs from 'node:fs/promises'
import path from 'node:path'

import { buildStockDataAction } from './build-data'
import { downloadStockDataAction } from './download-data'
import { scrapeEpsAction } from './scrape-eps'
import type { SkippedStockActionResult } from './download-data'

// Path, relative to the repo root, of the ticker watchlist that drives the seed.
export const TICKERS_FILE = path.join('config', 'tickers.json')

export type StepOutcome = 'ok' | 'skipped' | 'failed'

// The shared shape every stock action returns: a skip marker or a completed write.
type StockActionResult = SkippedStockActionResult | { skipped: false; rowCount: number; outputPath: string }
type StockAction = (stockCode: string) => Promise<StockActionResult>

export interface TickerSeedResult {
    stockCode: string
    download: StepOutcome
    scrapeEps: StepOutcome
    build: StepOutcome
}

export interface SeedWatchlistSummary {
    tickersFile: string
    tickers: string[]
    results: TickerSeedResult[]
}

interface SeedWatchlistDependencies {
    cwd?: () => string
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
    downloadStockData?: StockAction
    scrapeEps?: StockAction
    buildStockData?: StockAction
}

// Read the ticker watchlist, failing clearly when it is missing or malformed.
async function readTickers(readFile: (path: string, encoding: BufferEncoding) => Promise<string>, filePath: string): Promise<string[]> {
    let raw: string

    try {
        raw = await readFile(filePath, 'utf8')
    } catch {
        throw new Error(`Missing ticker list file: ${filePath}.`)
    }

    let parsed: unknown

    try {
        parsed = JSON.parse(raw)
    } catch (error) {
        throw new Error(`Failed to parse ticker list ${filePath}: ${(error as Error).message}`)
    }

    if (!Array.isArray(parsed) || !parsed.every((ticker) => typeof ticker === 'string')) {
        throw new Error(`Ticker list ${filePath} must be a JSON array of strings.`)
    }

    return parsed
}

// Run a single stock action for one ticker, translating its result into an
// outcome and a progress line so one failing step never aborts the whole run.
async function runStep(label: string, stockCode: string, action: StockAction, log: (message: string) => void): Promise<StepOutcome> {
    try {
        const result = await action(stockCode)

        if (result.skipped) {
            log(`  ${label}: skipped (${result.outputPath} already exists)`)
            return 'skipped'
        }

        log(`  ${label}: ok (${result.rowCount} rows -> ${result.outputPath})`)
        return 'ok'
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        log(`  ${label}: failed (${message})`)
        return 'failed'
    }
}

// Create the watchlist seed action so the CLI and UI can share the loop logic.
export function createSeedWatchlistAction({
    cwd = process.cwd,
    readFile = fs.readFile,
    downloadStockData = downloadStockDataAction,
    scrapeEps = scrapeEpsAction,
    buildStockData = buildStockDataAction,
}: SeedWatchlistDependencies = {}) {
    // Download, scrape EPS, and build combined data for every ticker in the
    // watchlist, reporting live progress through the injected logger.
    return async function seedWatchlistAction(log: (message: string) => void = () => {}): Promise<SeedWatchlistSummary> {
        const repoRoot = cwd()
        const tickersPath = path.join(repoRoot, TICKERS_FILE)
        const tickers = await readTickers(readFile, tickersPath)
        const results: TickerSeedResult[] = []

        for (let index = 0; index < tickers.length; index += 1) {
            const stockCode = tickers[index]

            log(`[${index + 1}/${tickers.length}] ${stockCode}`)

            results.push({
                stockCode,
                download: await runStep('download', stockCode, downloadStockData, log),
                scrapeEps: await runStep('scrape-eps', stockCode, scrapeEps, log),
                build: await runStep('build', stockCode, buildStockData, log),
            })
        }

        return { tickersFile: TICKERS_FILE, tickers, results }
    }
}

export const seedWatchlistAction = createSeedWatchlistAction()
