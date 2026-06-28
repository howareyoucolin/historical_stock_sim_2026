import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { writeDefaultUserAccountSession } from './model'
import { clearValueLog, readDailyValues, recordDailyValue, recordViewValueSnapshot, VALUES_LOG_RELATIVE_PATH } from './values-log'
import { setDefaultUserAccountDateToSpecificDate } from '../date/set-to-specific-date'
import { stockDataFetcher } from '../../test-helpers/market-data'

// Build a temporary repo root so value-log tests can write to an isolated user-sessions directory.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify recorded snapshots read back sorted by date, collapsing repeats to the last value written.
async function testReadDailyValuesDedupesByDate(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const cwd = () => tempRepoRoot

    await recordDailyValue({ date: '2018-03-19', value: 1500 }, { cwd })
    await recordDailyValue({ date: '2018-03-12', value: 1000 }, { cwd })
    // A later snapshot for an already-recorded day supersedes the earlier one (e.g. a same-day trade).
    await recordDailyValue({ date: '2018-03-19', value: 1600 }, { cwd })

    const snapshots = await readDailyValues({ cwd })

    assert.deepEqual(snapshots, [
        { date: '2018-03-12', value: 1000 },
        { date: '2018-03-19', value: 1600 },
    ])
}

// Verify a missing log reads as an empty series rather than throwing.
async function testReadDailyValuesMissingLog(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    assert.deepEqual(await readDailyValues({ cwd: () => tempRepoRoot }), [])
}

// Verify the view helper records cash plus holdings market value for the account's current date.
async function testRecordViewValueSnapshot(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const cwd = () => tempRepoRoot

    await recordViewValueSnapshot(
        {
            account: { date: '2018-03-12', cash: 250, positions: {} },
            rows: [],
            summary: { principal: 0, totalCurrentValue: 1750, totalGainLoss: 0, percentGainLoss: 0, totalDayChange: 0, dayChangePercent: 0 },
        },
        { cwd }
    )

    assert.deepEqual(await readDailyValues({ cwd }), [{ date: '2018-03-12', value: 2000 }])
}

// Verify clearing the log removes the file so a reset starts from an empty value history.
async function testClearValueLog(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const cwd = () => tempRepoRoot

    await recordDailyValue({ date: '2018-03-12', value: 1000 }, { cwd })
    await clearValueLog({ cwd })

    await assert.rejects(() => fs.readFile(path.join(tempRepoRoot, VALUES_LOG_RELATIVE_PATH), 'utf8'), /ENOENT/)
    assert.deepEqual(await readDailyValues({ cwd }), [])
}

// Verify advancing the date records one snapshot per stepped trading day, carrying a missing day's
// price forward from the previous close.
async function testAdvanceRecordsDailyValueSeries(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const cwd = () => tempRepoRoot

    await writeDefaultUserAccountSession(
        {
            date: '2018-03-09',
            cash: 100,
            positions: { AAPL: [{ quantity: 10, cost_per_share: 50, purchase_date: '2018-01-02' }] },
        },
        { cwd }
    )

    await setDefaultUserAccountDateToSpecificDate('2018-03-26', {
        cwd,
        getTradingCalendar: async () => ['2018-03-12', '2018-03-19', '2018-03-26'],
        getStockData: stockDataFetcher({
            AAPL: {
                '2018-03-12': { close: 60 },
                '2018-03-26': { close: 62 },
            },
        }),
        getCorporateActions: async () => [],
    })

    assert.deepEqual(await readDailyValues({ cwd }), [
        { date: '2018-03-12', value: 700 }, // 10 * 60 + 100 cash
        { date: '2018-03-19', value: 700 }, // no 03-19 close, carries 60 forward
        { date: '2018-03-26', value: 720 }, // 10 * 62 + 100 cash
    ])
}

// Run the focused value-log tests that protect recording, reading, and the advance-driven series.
export async function runValuesLogActionTests(): Promise<void> {
    await testReadDailyValuesDedupesByDate()
    await testReadDailyValuesMissingLog()
    await testRecordViewValueSnapshot()
    await testClearValueLog()
    await testAdvanceRecordsDailyValueSeries()
}
