import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, HISTORY_FILE_NAME } from '../stock/download-data'
import { readDefaultUserAccountSession, writeDefaultUserAccountSession } from '../account/model'
import { setDefaultUserAccountDateToSpecificDate } from './set-to-specific-date'
import { TRADING_CALENDAR_STOCK_CODE } from './advance'
import { accrueInterestOverGap } from '../account/cash-interest'

// Build a temporary repo root so date-set action tests can mutate an isolated session file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Write a stock's history.json with the given per-date entries.
async function writeStockHistory(
    tempRepoRoot: string,
    stockCode: string,
    historyByDate: Record<string, { close: number; isPayoutDate: boolean; dividendPerShare: number }>
): Promise<void> {
    const outputDirectory = path.join(tempRepoRoot, DATA_DIRECTORY_NAME, stockCode)

    await fs.mkdir(outputDirectory, { recursive: true })
    await fs.writeFile(path.join(outputDirectory, HISTORY_FILE_NAME), `${JSON.stringify({ stockCode, historyByDate }, null, 2)}\n`, 'utf8')
}

// Write the reference trading calendar (SPY history) with the given set of market dates.
async function writeTradingCalendar(tempRepoRoot: string, tradingDates: string[]): Promise<void> {
    const historyByDate = Object.fromEntries(tradingDates.map((date) => [date, { close: 1, isPayoutDate: false, dividendPerShare: 0 }]))

    await writeStockHistory(tempRepoRoot, TRADING_CALENDAR_STOCK_CODE, historyByDate)
}

// Verify setting a forward date steps to the target trading day and preserves the rest of the session.
async function testSetDefaultUserAccountDateToSpecificDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeTradingCalendar(tempRepoRoot, ['2018-03-12', '2018-03-29', '2018-04-02'])
    await writeDefaultUserAccountSession(
        {
            date: '2018-03-10',
            cash: 1200,
            positions: { AAPL: [{ quantity: 3, cost_per_share: 200, purchase_date: '2018-03-01' }] },
        },
        { cwd: () => tempRepoRoot }
    )

    const account = await setDefaultUserAccountDateToSpecificDate('2018-04-02', { cwd: () => tempRepoRoot })
    const savedAccount = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    assert.equal(account.date, '2018-04-02')
    // Crossing into April pays out interest accrued on the parked $1200 across the whole span, so the
    // expected cash is the starting balance plus that month's accrued interest (no dividends here).
    // A tiny tolerance absorbs float-summation grouping differences between per-step and single-call accrual.
    const expectedInterest = accrueInterestOverGap(1200, '2018-03-10', '2018-04-02')
    assert.ok(Math.abs(account.cash - (1200 + expectedInterest)) < 1e-6, `cash ${account.cash} should be ~${1200 + expectedInterest}`)
    assert.ok(expectedInterest > 0)
    assert.deepEqual(account.positions, { AAPL: [{ quantity: 3, cost_per_share: 200, purchase_date: '2018-03-01' }] })
    assert.deepEqual(savedAccount, account)
}

// Verify stepping to a target date applies every dividend paid by held stocks along the way.
async function testSetDefaultUserAccountDateToSpecificDateAppliesDividendsAlongTheWay(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeTradingCalendar(tempRepoRoot, ['2018-03-12', '2018-03-19', '2018-03-26'])
    await writeStockHistory(tempRepoRoot, 'AAPL', {
        '2018-03-12': { close: 60, isPayoutDate: true, dividendPerShare: 0.5 },
        '2018-03-26': { close: 62, isPayoutDate: true, dividendPerShare: 0.5 },
    })
    await writeDefaultUserAccountSession(
        {
            date: '2018-03-09',
            cash: 100,
            positions: { AAPL: [{ quantity: 10, cost_per_share: 50, purchase_date: '2018-01-02' }] },
        },
        { cwd: () => tempRepoRoot }
    )

    const account = await setDefaultUserAccountDateToSpecificDate('2018-03-26', { cwd: () => tempRepoRoot })

    assert.equal(account.date, '2018-03-26')
    // Two $0.50 payouts on 10 shares are collected while stepping (a direct jump would miss 03-12).
    assert.equal(account.cash, 110)
}

// Verify invalid specific dates fail before the shared session is rewritten.
async function testSetDefaultUserAccountDateToSpecificDateInvalidDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await assert.rejects(() => setDefaultUserAccountDateToSpecificDate('2018-02-30', { cwd: () => tempRepoRoot }), /Date must be a valid YYYY-MM-DD value/)
}

// Verify setting a past date is rejected so the simulation timeline only moves forward.
async function testSetDefaultUserAccountDateToSpecificDateBackwardDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession({ date: '2018-03-10', cash: 1200, positions: {} }, { cwd: () => tempRepoRoot })

    await assert.rejects(
        () => setDefaultUserAccountDateToSpecificDate('2018-03-09', { cwd: () => tempRepoRoot }),
        /Simulation date cannot move backward from 2018-03-10/
    )
}

// Verify setting the current date again is allowed as a no-op instead of being treated as backward.
async function testSetDefaultUserAccountDateToSpecificDateSameDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession({ date: '2018-03-10', cash: 1200, positions: {} }, { cwd: () => tempRepoRoot })

    const account = await setDefaultUserAccountDateToSpecificDate('2018-03-10', { cwd: () => tempRepoRoot })

    assert.equal(account.date, '2018-03-10')
    assert.equal(account.cash, 1200)
    assert.deepEqual(account.positions, {})
}

// Run the focused date-set action tests that protect forward stepping and dividend application.
export async function runSetDateToSpecificDateActionTests(): Promise<void> {
    await testSetDefaultUserAccountDateToSpecificDate()
    await testSetDefaultUserAccountDateToSpecificDateAppliesDividendsAlongTheWay()
    await testSetDefaultUserAccountDateToSpecificDateInvalidDate()
    await testSetDefaultUserAccountDateToSpecificDateBackwardDate()
    await testSetDefaultUserAccountDateToSpecificDateSameDate()
}
