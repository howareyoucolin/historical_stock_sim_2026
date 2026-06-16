import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME } from '../stock/download-data'
import {
    readDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountState,
    writeDefaultUserAccountSession,
} from '../account/model'
import { findNextTradingDate, normalizeSimulationDate } from './utils'

// SPY trades every NYSE session, so its saved history doubles as the market trading calendar.
export const TRADING_CALENDAR_STOCK_CODE = 'SPY'

interface MarketHistoryEntry {
    isPayoutDate?: boolean
    dividendPerShare?: number
}

type HistoryByDate = Record<string, MarketHistoryEntry>

interface StockHistoryPayload {
    historyByDate?: HistoryByDate
}

export interface DividendPayout {
    stockCode: string
    date: string
    shares: number
    perShare: number
    amount: number
}

export interface AdvanceSimulationResult {
    account: AccountState
    dividends: DividendPayout[]
    totalDividends: number
}

export interface AdvanceSimulationDependencies extends AccountSessionDependencies {
    readMarketDataFile?: (path: string, encoding: BufferEncoding) => Promise<string>
}

// Read the trading calendar (the set of real market days) from the reference stock's saved history.
async function readTradingCalendar(cwd: () => string, readMarketDataFile: (path: string, encoding: BufferEncoding) => Promise<string>): Promise<string[]> {
    const historyFilePath = path.join(cwd(), DATA_DIRECTORY_NAME, TRADING_CALENDAR_STOCK_CODE, HISTORY_FILE_NAME)

    try {
        const payload = JSON.parse(await readMarketDataFile(historyFilePath, 'utf8')) as StockHistoryPayload

        return Object.keys(payload.historyByDate ?? {})
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`No trading calendar found. Run \`stock download ${TRADING_CALENDAR_STOCK_CODE}\` first.`)
        }

        if (error instanceof SyntaxError) {
            throw new Error(`Invalid trading calendar JSON for ${TRADING_CALENDAR_STOCK_CODE}: ${error.message}`)
        }

        throw error
    }
}

// Expose the sorted trading calendar so the UI can restrict date pickers to real market days.
export async function getTradingCalendarDates({
    cwd = process.cwd,
    readMarketDataFile = fs.readFile,
}: AdvanceSimulationDependencies = {}): Promise<string[]> {
    const dates = await readTradingCalendar(cwd, readMarketDataFile)

    return dates.sort()
}

// Read a held stock's daily history for dividend lookups; a missing file simply yields no
// dividends so a gap in local data never blocks advancing the simulation date.
async function readStockHistoryMap(
    stockCode: string,
    cwd: () => string,
    readMarketDataFile: (path: string, encoding: BufferEncoding) => Promise<string>
): Promise<HistoryByDate> {
    const historyFilePath = path.join(cwd(), DATA_DIRECTORY_NAME, stockCode, HISTORY_FILE_NAME)

    try {
        const payload = JSON.parse(await readMarketDataFile(historyFilePath, 'utf8')) as StockHistoryPayload

        return payload.historyByDate ?? {}
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {}
        }

        if (error instanceof SyntaxError) {
            throw new Error(`Invalid stock history JSON for ${stockCode}: ${error.message}`)
        }

        throw error
    }
}

// Advance the simulation one trading day at a time, crediting cash dividends on each payout
// date, until either a single step is taken (targetDate null) or the date reaches the target.
export async function advanceSimulationDate(
    targetDate: string | null,
    {
        cwd = process.cwd,
        makeDirectory,
        readFile,
        writeFile,
        readMarketDataFile = fs.readFile,
    }: AdvanceSimulationDependencies = {}
): Promise<AdvanceSimulationResult> {
    const sessionDependencies: AccountSessionDependencies = { cwd, makeDirectory, readFile, writeFile }
    const account = await readDefaultUserAccountSession(sessionDependencies)

    let normalizedTarget: string | null = null

    if (targetDate !== null) {
        normalizedTarget = normalizeSimulationDate(targetDate)

        if (normalizedTarget < account.date) {
            throw new Error(`Simulation date cannot move backward from ${account.date}.`)
        }

        // Already at or past the target: nothing to advance and no market data is needed.
        if (normalizedTarget === account.date) {
            return { account, dividends: [], totalDividends: 0 }
        }
    }

    const calendar = await readTradingCalendar(cwd, readMarketDataFile)

    // Total shares held per stock stay constant while advancing, so resolve them once up front.
    const sharesByStock: Record<string, number> = {}
    for (const [stockCode, lots] of Object.entries(account.positions)) {
        const shares = lots.reduce((total, lot) => total + lot.quantity, 0)

        if (shares > 0) {
            sharesByStock[stockCode] = shares
        }
    }

    const historyByStock: Record<string, HistoryByDate> = {}
    for (const stockCode of Object.keys(sharesByStock)) {
        historyByStock[stockCode] = await readStockHistoryMap(stockCode, cwd, readMarketDataFile)
    }

    let date = account.date
    let cash = account.cash
    const dividends: DividendPayout[] = []

    // Move to the next trading day and credit any dividends paid by held stocks on that day.
    const stepToNextTradingDay = (): void => {
        const nextDate = findNextTradingDate(date, calendar)

        if (nextDate === null) {
            throw new Error(`No trading day available after ${date}. Download more recent market data to continue.`)
        }

        date = nextDate

        for (const [stockCode, shares] of Object.entries(sharesByStock)) {
            const entry = historyByStock[stockCode]?.[date]

            if (entry?.isPayoutDate && entry.dividendPerShare) {
                const amount = shares * entry.dividendPerShare

                cash += amount
                dividends.push({ stockCode, date, shares, perShare: entry.dividendPerShare, amount })
            }
        }
    }

    if (normalizedTarget === null) {
        stepToNextTradingDay()
    } else {
        while (date < normalizedTarget) {
            stepToNextTradingDay()
        }
    }

    const updatedAccount: AccountState = { ...account, date, cash }

    return {
        account: await writeDefaultUserAccountSession(updatedAccount, sessionDependencies),
        dividends,
        totalDividends: dividends.reduce((total, dividend) => total + dividend.amount, 0),
    }
}
