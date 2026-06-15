import assert from 'node:assert/strict'

import { createRunCommand, getHelpText } from './commands'

// Verify the CLI help text advertises the shared account init command.
function testGetHelpText(): void {
    assert.match(getHelpText(), /account init/)
    assert.match(getHelpText(), /account deposit <cash>/)
    assert.match(getHelpText(), /stock download <code>/)
}

// Verify account init calls the shared session initializer and reports the session file path.
async function testAccountInitCommand(): Promise<void> {
    let initializerWasCalled = false
    const runCommand = createRunCommand({
        initializeDefaultUserAccount: async () => {
            initializerWasCalled = true

            return {
                cash: 0,
                positions: {},
            }
        },
    })

    const result = await runCommand('account init')

    assert.equal(initializerWasCalled, true)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /user-sessions\/default\.json/)
}

// Verify account deposit calls the shared session updater with the provided cash delta.
async function testAccountDepositCommand(): Promise<void> {
    let capturedCashDelta = 0
    const runCommand = createRunCommand({
        depositIntoDefaultUserAccount: async (valueCash) => {
            capturedCashDelta = valueCash

            return {
                cash: 125.5,
                positions: {},
            }
        },
    })

    const result = await runCommand('account deposit -25.5')

    assert.equal(capturedCashDelta, -25.5)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Cash: 125.5/)
}

// Verify invalid deposit values are rejected before the shared session updater runs.
async function testAccountDepositInvalidValue(): Promise<void> {
    const runCommand = createRunCommand()
    const result = await runCommand('account deposit nope')

    assert.equal(result.exitCode, 1)
    assert.equal(result.output, 'Cash value must be a finite number.')
}

// Verify bad account command arguments return the expected usage guidance.
async function testAccountCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()
    const badAccountResult = await runCommand('account wrong')
    const badDepositResult = await runCommand('account deposit')

    assert.equal(badAccountResult.exitCode, 1)
    assert.equal(badAccountResult.output, 'Usage: account <init|deposit <value_cash>>')
    assert.equal(badDepositResult.exitCode, 1)
    assert.equal(badDepositResult.output, 'Usage: account deposit <value_cash>')
}

// Verify stock download still routes through the dedicated stock command handler.
async function testStockDownloadCommand(): Promise<void> {
    let requestedStockCode = ''
    const runCommand = createRunCommand({
        downloadStockData: async (stockCode) => {
            requestedStockCode = stockCode

            return {
                stockCode: 'AAPL',
                source: 'Yahoo Finance',
                range: { start: '2000-01-01', end: '2026-01-01' },
                historyByDate: {},
                rowCount: 42,
                outputPath: 'market-data/AAPL/history.json',
            }
        },
    })
    const result = await runCommand('stock download AAPL')

    assert.equal(requestedStockCode, 'AAPL')
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Downloaded 42 rows for AAPL\./)
}

// Run the focused tests that protect CLI account command wiring.
export async function runCliCommandTests(): Promise<void> {
    testGetHelpText()
    await testAccountInitCommand()
    await testAccountDepositCommand()
    await testAccountDepositInvalidValue()
    await testAccountCommandUsage()
    await testStockDownloadCommand()
}
