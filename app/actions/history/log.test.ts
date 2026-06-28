import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buyStockInDefaultUserAccountSession } from '../account/buy'
import { DEFAULT_ACCOUNT_DATE, writeDefaultUserAccountSession } from '../account/model'
import { appendHistoryEvent, clearHistoryLog, readHistoryLogEntries, showHistoryLog, HISTORY_LOG_RELATIVE_PATH } from './log'
import { stockDataFetcher } from '../../test-helpers/market-data'

// Build a temporary repo root so history log tests can write to an isolated log file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Use a fixed timestamp so the formatted log line is deterministic across runs.
function fixedNow(): Date {
    return new Date('2026-06-16T14:23:01.123Z')
}

// Verify each event type renders only its relevant tokens and signs the cash impact correctly.
async function testAppendHistoryEventFormatsLines(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const logFilePath = path.join(tempRepoRoot, HISTORY_LOG_RELATIVE_PATH)

    await appendHistoryEvent(
        { type: 'BUY', simDate: '2016-01-04', stockCode: 'AAPL', quantity: 3, pricePerShare: 105.35, cashDelta: -316.05 },
        { cwd: () => tempRepoRoot, now: fixedNow }
    )
    await appendHistoryEvent(
        { type: 'DEPOSIT', simDate: '2016-01-04', cashDelta: 5000 },
        { cwd: () => tempRepoRoot, now: fixedNow }
    )
    await appendHistoryEvent(
        { type: 'DIVIDEND', simDate: '2016-02-10', stockCode: 'AAPL', quantity: 3, pricePerShare: 0.52, cashDelta: 1.56 },
        { cwd: () => tempRepoRoot, now: fixedNow }
    )

    const lines = (await fs.readFile(logFilePath, 'utf8')).trim().split('\n')

    assert.equal(lines[0], '2026-06-16T14:23:01.123Z BUY stock=AAPL qty=3 price=105.35 cash=-316.05 sim=2016-01-04')
    assert.equal(lines[1], '2026-06-16T14:23:01.123Z DEPOSIT cash=+5000.00 sim=2016-01-04')
    assert.equal(lines[2], '2026-06-16T14:23:01.123Z DIVIDEND stock=AAPL qty=3 price=0.52 cash=+1.56 sim=2016-02-10')
}

// Verify show returns a friendly placeholder when no log file exists yet.
async function testShowHistoryLogWhenMissing(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    const output = await showHistoryLog({ cwd: () => tempRepoRoot })

    assert.equal(output, 'No history events recorded yet.')
}

// Verify show returns the recorded lines in the order they were appended.
async function testShowHistoryLogReturnsEntries(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await appendHistoryEvent(
        { type: 'DEPOSIT', simDate: '2016-01-04', cashDelta: 1000 },
        { cwd: () => tempRepoRoot, now: fixedNow }
    )
    await appendHistoryEvent(
        { type: 'SELL', simDate: '2016-03-01', stockCode: 'AAPL', quantity: 2, pricePerShare: 110, cashDelta: 220 },
        { cwd: () => tempRepoRoot, now: fixedNow }
    )

    const output = await showHistoryLog({ cwd: () => tempRepoRoot })

    assert.equal(
        output,
        [
            '2026-06-16T14:23:01.123Z DEPOSIT cash=+1000.00 sim=2016-01-04',
            '2026-06-16T14:23:01.123Z SELL stock=AAPL qty=2 price=110.00 cash=+220.00 sim=2016-03-01',
        ].join('\n')
    )
}

// Verify a real buy records a BUY line, protecting the action-layer logging wiring.
async function testBuyAppendsHistoryEvent(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const logFilePath = path.join(tempRepoRoot, HISTORY_LOG_RELATIVE_PATH)

    await writeDefaultUserAccountSession(
        { date: DEFAULT_ACCOUNT_DATE, cash: 1000, positions: {} },
        { cwd: () => tempRepoRoot }
    )

    await buyStockInDefaultUserAccountSession('AAPL', 2, {
        cwd: () => tempRepoRoot,
        getStockData: stockDataFetcher({ AAPL: { [DEFAULT_ACCOUNT_DATE]: { close: 10.5 } } }),
    })

    const logContents = await fs.readFile(logFilePath, 'utf8')

    assert.match(logContents, /BUY stock=AAPL qty=2 price=10.50 cash=-21.00 sim=2016-01-04/)
}

// Verify a note is appended last as a JSON-quoted token so multi-word text stays on one line
// without disturbing the earlier space-separated fields.
async function testAppendHistoryEventRecordsNote(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const logFilePath = path.join(tempRepoRoot, HISTORY_LOG_RELATIVE_PATH)

    await appendHistoryEvent(
        { type: 'BUY', simDate: '2016-01-04', stockCode: 'AAPL', quantity: 3, pricePerShare: 105.35, cashDelta: -316.05, note: 'buy the dip' },
        { cwd: () => tempRepoRoot, now: fixedNow }
    )

    const line = (await fs.readFile(logFilePath, 'utf8')).trim()

    assert.equal(line, '2026-06-16T14:23:01.123Z BUY stock=AAPL qty=3 price=105.35 cash=-316.05 sim=2016-01-04 note="buy the dip"')
}

// Verify a real buy forwards its note to the recorded BUY line.
async function testBuyForwardsNoteToHistory(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const logFilePath = path.join(tempRepoRoot, HISTORY_LOG_RELATIVE_PATH)

    await writeDefaultUserAccountSession(
        { date: DEFAULT_ACCOUNT_DATE, cash: 1000, positions: {} },
        { cwd: () => tempRepoRoot }
    )

    await buyStockInDefaultUserAccountSession(
        'AAPL',
        2,
        {
            cwd: () => tempRepoRoot,
            getStockData: stockDataFetcher({ AAPL: { [DEFAULT_ACCOUNT_DATE]: { close: 10.5 } } }),
        },
        'dca tranche'
    )

    const logContents = await fs.readFile(logFilePath, 'utf8')

    assert.match(logContents, /note="dca tranche"/)
}

// Verify clearing removes recorded entries and tolerates a log file that does not exist yet.
async function testClearHistoryLog(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    // Clearing before anything is logged should not throw.
    await clearHistoryLog({ cwd: () => tempRepoRoot })

    await appendHistoryEvent(
        { type: 'DEPOSIT', simDate: '2016-01-04', cashDelta: 1000 },
        { cwd: () => tempRepoRoot, now: fixedNow }
    )
    await clearHistoryLog({ cwd: () => tempRepoRoot })

    assert.equal(await showHistoryLog({ cwd: () => tempRepoRoot }), 'No history events recorded yet.')
}

// Verify the entries reader returns one line per event and an empty array when nothing is recorded.
async function testReadHistoryLogEntries(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    assert.deepEqual(await readHistoryLogEntries({ cwd: () => tempRepoRoot }), [])

    await appendHistoryEvent(
        { type: 'DEPOSIT', simDate: '2016-01-04', cashDelta: 1000 },
        { cwd: () => tempRepoRoot, now: fixedNow }
    )
    await appendHistoryEvent(
        { type: 'SELL', simDate: '2016-03-01', stockCode: 'AAPL', quantity: 2, pricePerShare: 110, cashDelta: 220 },
        { cwd: () => tempRepoRoot, now: fixedNow }
    )

    assert.deepEqual(await readHistoryLogEntries({ cwd: () => tempRepoRoot }), [
        '2026-06-16T14:23:01.123Z DEPOSIT cash=+1000.00 sim=2016-01-04',
        '2026-06-16T14:23:01.123Z SELL stock=AAPL qty=2 price=110.00 cash=+220.00 sim=2016-03-01',
    ])
}

// Run the focused history log tests that protect log formatting, display, and action wiring.
export async function runHistoryLogActionTests(): Promise<void> {
    await testAppendHistoryEventFormatsLines()
    await testShowHistoryLogWhenMissing()
    await testShowHistoryLogReturnsEntries()
    await testBuyAppendsHistoryEvent()
    await testAppendHistoryEventRecordsNote()
    await testBuyForwardsNoteToHistory()
    await testClearHistoryLog()
    await testReadHistoryLogEntries()
}
