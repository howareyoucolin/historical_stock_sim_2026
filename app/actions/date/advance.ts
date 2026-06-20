import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME } from '../stock/download-data'
import { appendHistoryEvent } from '../history/log'
import {
    readDefaultUserAccountSession,
    type AccountSessionDependencies,
    type AccountPosition,
    type AccountState,
    writeDefaultUserAccountSession,
} from '../account/model'
import { recordDailyValue, type DailyValueSnapshot } from '../account/values-log'
import { accrueInterestOverGap } from '../account/cash-interest'
import {
    readCorporateActions,
    selectCorporateActionsForDate,
    type CorporateAction,
    type StockSwapCorporateAction,
} from '../account/corporate-actions'
import { findNextTradingDate, normalizeSimulationDate } from './utils'

// SPY trades every NYSE session, so its saved history doubles as the market trading calendar.
export const TRADING_CALENDAR_STOCK_CODE = 'SPY'

interface MarketHistoryEntry {
    close?: number | null
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

export interface InterestPayout {
    date: string
    amount: number
}

export interface CorporateActionPayout {
    stockCode: string
    date: string
    quantity: number
    pricePerShare: number
    cashDelta: number
    note: string
}

export interface AdvanceSimulationResult {
    account: AccountState
    dividends: DividendPayout[]
    totalDividends: number
    // Interest paid on parked cash during the advance; optional so callers/mocks can omit it.
    interest?: InterestPayout[]
    totalInterest?: number
    corporateActions?: CorporateActionPayout[]
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

// Clone the held lots so date advancement can mutate positions without touching the loaded account object.
function clonePositionsByStock(positions: Record<string, AccountPosition[]>): Record<string, AccountPosition[]> {
    return Object.fromEntries(
        Object.entries(positions).map(([stockCode, lots]) => [stockCode, lots.map((lot) => ({ ...lot }))])
    )
}

// Sum the share count for one holding across all of its lots.
function countHeldShares(lots: AccountPosition[]): number {
    return lots.reduce((total, lot) => total + lot.quantity, 0)
}

// Build a stock -> shares map for the lots currently held in the mutable working account.
function countSharesByStock(positions: Record<string, AccountPosition[]>): Record<string, number> {
    const sharesByStock: Record<string, number> = {}

    for (const [stockCode, lots] of Object.entries(positions)) {
        const shares = countHeldShares(lots)

        if (shares > 0) {
            sharesByStock[stockCode] = shares
        }
    }

    return sharesByStock
}

// Add converted lots into the destination holding, preserving purchase dates so holding periods survive mergers.
function appendConvertedLots(
    positions: Record<string, AccountPosition[]>,
    stockCode: string,
    lots: AccountPosition[]
): void {
    if (lots.length === 0) {
        return
    }

    positions[stockCode] = [...(positions[stockCode] ?? []), ...lots]
}

// Read a stock's history lazily when a corporate action introduces a new holding mid-simulation.
async function ensureHistoryByStock(
    stockCode: string,
    historyByStock: Record<string, HistoryByDate>,
    cwd: () => string,
    readMarketDataFile: (path: string, encoding: BufferEncoding) => Promise<string>
): Promise<HistoryByDate> {
    if (!historyByStock[stockCode]) {
        historyByStock[stockCode] = await readStockHistoryMap(stockCode, cwd, readMarketDataFile)
    }

    return historyByStock[stockCode]
}

// Describe one corporate action in the history log so the account trail explains why holdings changed.
function formatCorporateActionNote(action: CorporateAction): string {
    switch (action.type) {
        case 'cash_buyout':
            return action.note ?? `Cash buyout at ${action.cashPerShare.toFixed(2)} per share`
        case 'stock_swap':
            return action.note ?? `Converted into ${action.acquirerStockCode} at ${action.shareRatio} shares per share`
        case 'equity_wipeout':
            return action.note ?? 'Common equity wiped out'
        case 'otc_continuation':
            return action.note ?? 'Moved off-exchange / OTC continuation'
    }
}

// Convert a held stock into the acquirer using the configured share ratio, paying any fractional remainder in cash.
function applyStockSwapToLots(lots: AccountPosition[], action: StockSwapCorporateAction): { convertedLots: AccountPosition[]; cashDelta: number } {
    const convertedLots: AccountPosition[] = []
    let cashDelta = 0

    for (const lot of lots) {
        const rawAcquirerShares = lot.quantity * action.shareRatio
        const wholeAcquirerShares = Math.floor(rawAcquirerShares + 1e-9)
        const fractionalAcquirerShares = rawAcquirerShares - wholeAcquirerShares

        if (wholeAcquirerShares > 0) {
            convertedLots.push({
                quantity: wholeAcquirerShares,
                cost_per_share: lot.cost_per_share / action.shareRatio,
                purchase_date: lot.purchase_date,
            })
        }

        if (fractionalAcquirerShares > 0 && action.cashPerShare) {
            cashDelta += fractionalAcquirerShares * action.cashPerShare
        }
    }

    return { convertedLots, cashDelta }
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
            return { account, dividends: [], totalDividends: 0, interest: [], totalInterest: 0 }
        }
    }

    const calendar = await readTradingCalendar(cwd, readMarketDataFile)
    const corporateActions = await readCorporateActions({ cwd, readConfigFile: readMarketDataFile })

    const positionsByStock = clonePositionsByStock(account.positions)
    const historyByStock: Record<string, HistoryByDate> = {}
    for (const stockCode of Object.keys(positionsByStock)) {
        historyByStock[stockCode] = await readStockHistoryMap(stockCode, cwd, readMarketDataFile)
    }

    let date = account.date
    let cash = account.cash
    // Interest accrued on parked cash since the last payout; seeded from any carried-over balance.
    let accruedInterest = account.accruedInterest ?? 0
    const dividends: DividendPayout[] = []
    const interestPayouts: InterestPayout[] = []
    const corporateActionPayouts: CorporateActionPayout[] = []

    // Track each holding's most recent close so a day missing local data carries the prior price
    // forward instead of dropping the position from the portfolio value for that day.
    const lastCloseByStock: Record<string, number> = {}
    for (const stockCode of Object.keys(positionsByStock)) {
        const startingClose = historyByStock[stockCode]?.[date]?.close

        if (typeof startingClose === 'number') {
            lastCloseByStock[stockCode] = startingClose
        }
    }

    // Total portfolio value on the current day: cash plus the market value of every held position.
    const portfolioValueSnapshot = (): DailyValueSnapshot => {
        const sharesByStock = countSharesByStock(positionsByStock)
        const holdingsValue = Object.entries(sharesByStock).reduce(
            (total, [stockCode, shares]) => total + shares * (lastCloseByStock[stockCode] ?? 0),
            0
        )

        return { date, value: cash + holdingsValue }
    }

    // Daily total-value snapshots, one per trading day stepped, recorded after the account is saved.
    const valueSnapshots: DailyValueSnapshot[] = []

    // Move to the next trading day, credit any dividends paid by held stocks, refresh their closing
    // prices, and capture the resulting total portfolio value for that day.
    const stepToNextTradingDay = async (): Promise<void> => {
        const nextDate = findNextTradingDate(date, calendar)

        if (nextDate === null) {
            throw new Error(`No trading day available after ${date}. Download more recent market data to continue.`)
        }

        // Accrue interest on parked cash across the calendar days bridging to the next trading day,
        // then pay it out (so it compounds) on the first trading day of each new month.
        accruedInterest += accrueInterestOverGap(cash, date, nextDate)
        const crossedIntoNewMonth = nextDate.slice(0, 7) !== date.slice(0, 7)

        date = nextDate

        if (crossedIntoNewMonth && accruedInterest > 0) {
            cash += accruedInterest
            interestPayouts.push({ date, amount: accruedInterest })
            accruedInterest = 0
        }

        const sharesByStock = countSharesByStock(positionsByStock)
        for (const [stockCode, shares] of Object.entries(sharesByStock)) {
            const entry = historyByStock[stockCode]?.[date]

            if (typeof entry?.close === 'number') {
                lastCloseByStock[stockCode] = entry.close
            }

            if (entry?.isPayoutDate && entry.dividendPerShare) {
                const amount = shares * entry.dividendPerShare

                cash += amount
                dividends.push({ stockCode, date, shares, perShare: entry.dividendPerShare, amount })
            }
        }

        for (const action of selectCorporateActionsForDate(corporateActions, date)) {
            const heldLots = positionsByStock[action.stockCode] ?? []

            if (heldLots.length === 0) {
                continue
            }

            const heldShares = countHeldShares(heldLots)

            switch (action.type) {
                case 'cash_buyout': {
                    const cashDelta = heldShares * action.cashPerShare

                    cash += cashDelta
                    delete positionsByStock[action.stockCode]
                    delete lastCloseByStock[action.stockCode]
                    corporateActionPayouts.push({
                        stockCode: action.stockCode,
                        date,
                        quantity: heldShares,
                        pricePerShare: action.cashPerShare,
                        cashDelta,
                        note: formatCorporateActionNote(action),
                    })
                    break
                }
                case 'stock_swap': {
                    const { convertedLots, cashDelta } = applyStockSwapToLots(heldLots, action)

                    delete positionsByStock[action.stockCode]
                    delete lastCloseByStock[action.stockCode]
                    appendConvertedLots(positionsByStock, action.acquirerStockCode, convertedLots)
                    await ensureHistoryByStock(action.acquirerStockCode, historyByStock, cwd, readMarketDataFile)

                    const acquirerClose = historyByStock[action.acquirerStockCode]?.[date]?.close
                    if (typeof acquirerClose === 'number') {
                        lastCloseByStock[action.acquirerStockCode] = acquirerClose
                    }

                    cash += cashDelta
                    corporateActionPayouts.push({
                        stockCode: action.stockCode,
                        date,
                        quantity: heldShares,
                        pricePerShare: action.cashPerShare ?? 0,
                        cashDelta,
                        note: formatCorporateActionNote(action),
                    })
                    break
                }
                case 'equity_wipeout':
                    delete positionsByStock[action.stockCode]
                    delete lastCloseByStock[action.stockCode]
                    corporateActionPayouts.push({
                        stockCode: action.stockCode,
                        date,
                        quantity: heldShares,
                        pricePerShare: 0,
                        cashDelta: 0,
                        note: formatCorporateActionNote(action),
                    })
                    break
                case 'otc_continuation':
                    corporateActionPayouts.push({
                        stockCode: action.stockCode,
                        date,
                        quantity: heldShares,
                        pricePerShare: 0,
                        cashDelta: 0,
                        note: formatCorporateActionNote(action),
                    })
                    break
            }
        }

        valueSnapshots.push(portfolioValueSnapshot())
    }

    if (normalizedTarget === null) {
        await stepToNextTradingDay()
    } else {
        while (date < normalizedTarget) {
            await stepToNextTradingDay()
        }
    }

    const updatedAccount: AccountState = { ...account, date, cash, positions: positionsByStock }

    // Carry the running accrued interest forward, or clear it once it has been paid out, so the
    // persisted account only keeps a non-zero in-progress balance.
    if (accruedInterest > 0) {
        updatedAccount.accruedInterest = accruedInterest
    } else {
        delete updatedAccount.accruedInterest
    }

    const savedAccount = await writeDefaultUserAccountSession(updatedAccount, sessionDependencies)

    // Persist the daily value series so the summary graph can plot how the portfolio moved over time.
    for (const snapshot of valueSnapshots) {
        await recordDailyValue(snapshot, { cwd })
    }

    // Record each credited payout so the history log captures dividends alongside trades and deposits.
    for (const dividend of dividends) {
        await appendHistoryEvent(
            {
                type: 'DIVIDEND',
                simDate: dividend.date,
                stockCode: dividend.stockCode,
                quantity: dividend.shares,
                pricePerShare: dividend.perShare,
                cashDelta: dividend.amount,
            },
            { cwd }
        )
    }

    // Record each monthly interest payout so it appears in the audit trail and the tax report.
    for (const payout of interestPayouts) {
        await appendHistoryEvent({ type: 'INTEREST', simDate: payout.date, cashDelta: payout.amount }, { cwd })
    }

    // Record corporate-action outcomes so delistings and mergers are visible in the audit log.
    for (const action of corporateActionPayouts) {
        await appendHistoryEvent(
            {
                type: 'CORPORATE_ACTION',
                simDate: action.date,
                stockCode: action.stockCode,
                quantity: action.quantity,
                pricePerShare: action.pricePerShare,
                cashDelta: action.cashDelta,
                note: action.note,
            },
            { cwd }
        )
    }

    return {
        account: savedAccount,
        dividends,
        totalDividends: dividends.reduce((total, dividend) => total + dividend.amount, 0),
        interest: interestPayouts,
        totalInterest: interestPayouts.reduce((total, payout) => total + payout.amount, 0),
        corporateActions: corporateActionPayouts,
    }
}
