import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_ACCOUNT_DATE, readDefaultUserAccountSession, writeDefaultUserAccountSession } from '../account/model'
import { setDefaultUserAccountDateToTomorrow } from './set-to-tomorrow'
import { findNextTradingDate } from './utils'
import { stockDataFetcher } from '../../test-helpers/market-data'

// Build a temporary repo root so date-next action tests can mutate an isolated session file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify findNextTradingDate returns the earliest date strictly after the input, ignoring ordering.
function testFindNextTradingDate(): void {
    const calendar = ['2018-03-13', '2018-03-09', '2018-03-12']

    assert.equal(findNextTradingDate('2018-03-09', calendar), '2018-03-12')
    assert.equal(findNextTradingDate('2018-03-10', calendar), '2018-03-12')
    assert.equal(findNextTradingDate('2018-03-13', calendar), null)
}

// Verify advancing skips weekends and holidays, landing on the next real trading day.
async function testSetDefaultUserAccountDateToTomorrowSkipsClosedDays(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    // Friday 2018-03-09, then a gap over the weekend and the 2018-03-30 Good Friday holiday.
    const calendar = async () => ['2018-03-09', '2018-03-12', '2018-03-29', '2018-04-02']
    await writeDefaultUserAccountSession(
        {
            date: '2018-03-09',
            cash: 1200,
            positions: { AAPL: [{ quantity: 3, cost_per_share: 200, purchase_date: '2018-03-01' }] },
        },
        { cwd: () => tempRepoRoot }
    )

    const afterWeekend = await setDefaultUserAccountDateToTomorrow({
        cwd: () => tempRepoRoot,
        getTradingCalendar: calendar,
        getStockData: stockDataFetcher({}),
        getCorporateActions: async () => [],
    })
    const savedAccount = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    // Saturday/Sunday are skipped: Friday advances to Monday.
    assert.equal(afterWeekend.date, '2018-03-12')
    assert.equal(afterWeekend.cash, 1200)
    assert.deepEqual(afterWeekend.positions, { AAPL: [{ quantity: 3, cost_per_share: 200, purchase_date: '2018-03-01' }] })
    assert.deepEqual(savedAccount, afterWeekend)

    // From Thursday 2018-03-29, the Good Friday holiday and weekend are skipped to Monday 2018-04-02.
    await writeDefaultUserAccountSession({ date: '2018-03-29', cash: 0, positions: {} }, { cwd: () => tempRepoRoot })
    const afterHoliday = await setDefaultUserAccountDateToTomorrow({
        cwd: () => tempRepoRoot,
        getTradingCalendar: calendar,
        getStockData: stockDataFetcher({}),
        getCorporateActions: async () => [],
    })

    assert.equal(afterHoliday.date, '2018-04-02')
}

// Verify advancing onto a held stock's payout date credits the cash dividend to the account.
async function testSetDefaultUserAccountDateToTomorrowAppliesDividend(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2018-03-09',
            cash: 100,
            positions: { AAPL: [{ quantity: 10, cost_per_share: 50, purchase_date: '2018-01-02' }] },
        },
        { cwd: () => tempRepoRoot }
    )

    const account = await setDefaultUserAccountDateToTomorrow({
        cwd: () => tempRepoRoot,
        getTradingCalendar: async () => ['2018-03-09', '2018-03-12'],
        getStockData: stockDataFetcher({ AAPL: { '2018-03-12': { close: 60, isPayoutDate: true, dividendPerShare: 0.5 } } }),
        getCorporateActions: async () => [],
    })

    assert.equal(account.date, '2018-03-12')
    // 10 shares x $0.50 dividend added to the starting $100.
    assert.equal(account.cash, 105)
}

// Verify advancing creates the default session and moves it to the next trading day.
async function testSetDefaultUserAccountDateToTomorrowCreatesDefaultSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    const account = await setDefaultUserAccountDateToTomorrow({
        cwd: () => tempRepoRoot,
        getTradingCalendar: async () => [DEFAULT_ACCOUNT_DATE, '2001-01-03'],
        getCorporateActions: async () => [],
    })

    assert.equal(account.date, '2001-01-03')
    assert.equal(account.cash, 0)
    assert.deepEqual(account.positions, {})
}

// Verify advancing past the end of the trading calendar fails with a clear error.
async function testSetDefaultUserAccountDateToTomorrowBeyondCalendar(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession({ date: '2016-01-04', cash: 0, positions: {} }, { cwd: () => tempRepoRoot })

    await assert.rejects(
        () =>
            setDefaultUserAccountDateToTomorrow({
                cwd: () => tempRepoRoot,
                getTradingCalendar: async () => ['2016-01-04'],
                getCorporateActions: async () => [],
            }),
        /No trading day available after 2016-01-04/
    )
}

// Verify an empty trading calendar produces a clear, actionable error rather than silently stalling.
async function testSetDefaultUserAccountDateToTomorrowMissingCalendar(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession({ date: '2016-01-04', cash: 0, positions: {} }, { cwd: () => tempRepoRoot })

    await assert.rejects(
        () =>
            setDefaultUserAccountDateToTomorrow({
                cwd: () => tempRepoRoot,
                getTradingCalendar: async () => [],
                getCorporateActions: async () => [],
            }),
        /No trading day available after 2016-01-04/
    )
}

// Run the focused date-next action tests that protect trading-day advancement behavior.
export async function runSetDateToTomorrowActionTests(): Promise<void> {
    testFindNextTradingDate()
    await testSetDefaultUserAccountDateToTomorrowSkipsClosedDays()
    await testSetDefaultUserAccountDateToTomorrowAppliesDividend()
    await testSetDefaultUserAccountDateToTomorrowCreatesDefaultSession()
    await testSetDefaultUserAccountDateToTomorrowBeyondCalendar()
    await testSetDefaultUserAccountDateToTomorrowMissingCalendar()
}
