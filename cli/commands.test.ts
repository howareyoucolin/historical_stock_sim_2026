import assert from 'node:assert/strict'

import { DEFAULT_ACCOUNT_DATE } from '../app/actions/account/model'
import { createRunCommand, getHelpText } from './commands'

// Verify the CLI help text advertises the shared account init command.
function testGetHelpText(): void {
    assert.match(getHelpText(), /account init/)
    assert.match(getHelpText(), /account buy <code> <qty>/)
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
                date: DEFAULT_ACCOUNT_DATE,
                cash: 0,
                positions: {},
            }
        },
    })

    const result = await runCommand('account init')

    assert.equal(initializerWasCalled, true)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /user-sessions\/default\.json/)
    assert.match(result.output, new RegExp(`Date: ${DEFAULT_ACCOUNT_DATE}`))
    assert.match(result.output, /Cash: 0.00/)
    assert.match(result.output, /Tracked symbols:\n\{\}/)
}

// Verify account deposit calls the shared session updater with the provided cash delta.
async function testAccountDepositCommand(): Promise<void> {
    let capturedCashDelta = 0
    const runCommand = createRunCommand({
        depositIntoDefaultUserAccount: async (valueCash) => {
            capturedCashDelta = valueCash

            return {
                date: '2018-03-10',
                cash: 125.5,
                positions: {},
            }
        },
    })

    const result = await runCommand('account deposit -25.5')

    assert.equal(capturedCashDelta, -25.5)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Date: 2018-03-10/)
    assert.match(result.output, /Cash: 125.50/)
    assert.match(result.output, /Tracked symbols:\n\{\}/)
}

// Verify account buy calls the shared purchase action with the provided stock code and quantity.
async function testAccountBuyCommand(): Promise<void> {
    let capturedStockCode = ''
    let capturedQuantity = 0
    const runCommand = createRunCommand({
        buyStockInDefaultUserAccount: async (stockCode, quantity) => {
            capturedStockCode = stockCode
            capturedQuantity = quantity

            return {
                stockCode: 'AAPL',
                quantity: 3,
                costPerShare: 10.5,
                totalCost: 31.5,
                account: {
                    date: DEFAULT_ACCOUNT_DATE,
                    cash: 968.5,
                    positions: {
                        AAPL: [
                            {
                                quantity: 3,
                                cost_per_share: 10.5,
                                purchase_date: DEFAULT_ACCOUNT_DATE,
                            },
                        ],
                    },
                },
            }
        },
    })

    const result = await runCommand('account buy aapl 3')

    assert.equal(capturedStockCode, 'aapl')
    assert.equal(capturedQuantity, 3)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Bought 3 shares of AAPL at 10.50/)
    assert.match(result.output, /Total cost: 31.50/)
    assert.match(result.output, new RegExp(`Date: ${DEFAULT_ACCOUNT_DATE}`))
    assert.match(result.output, /Cash: 968.50/)
    assert.match(result.output, /Tracked symbols:\n\{/)
    assert.match(result.output, /"AAPL": \[/)
    assert.match(result.output, /"cost_per_share": "10.50"/)
}

// Verify invalid deposit values are rejected before the shared session updater runs.
async function testAccountDepositInvalidValue(): Promise<void> {
    const runCommand = createRunCommand()
    const result = await runCommand('account deposit nope')

    assert.equal(result.exitCode, 1)
    assert.equal(result.output, 'Cash value must be a finite number.')
}

// Verify invalid buy quantities are rejected before the shared purchase action runs.
async function testAccountBuyInvalidQuantity(): Promise<void> {
    let buyWasCalled = false
    const runCommand = createRunCommand({
        buyStockInDefaultUserAccount: async () => {
            buyWasCalled = true
            throw new Error('This should not run.')
        },
    })
    const result = await runCommand('account buy AAPL nope')

    assert.equal(buyWasCalled, false)
    assert.equal(result.exitCode, 1)
    assert.equal(result.output, 'Quantity must be a positive integer.')
}

// Verify bad account command arguments return the expected usage guidance.
async function testAccountCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()
    const badAccountResult = await runCommand('account wrong')
    const badDepositResult = await runCommand('account deposit')
    const badBuyResult = await runCommand('account buy AAPL')

    assert.equal(badAccountResult.exitCode, 1)
    assert.equal(badAccountResult.output, 'Usage: account <init|deposit <value_cash>|buy <stock_code> <quantity>>')
    assert.equal(badDepositResult.exitCode, 1)
    assert.equal(badDepositResult.output, 'Usage: account deposit <value_cash>')
    assert.equal(badBuyResult.exitCode, 1)
    assert.equal(badBuyResult.output, 'Usage: account buy <stock_code> <quantity>')
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
                range: { start: '2016-01-01', end: '2026-01-01' },
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
    await testAccountBuyCommand()
    await testAccountDepositCommand()
    await testAccountDepositInvalidValue()
    await testAccountBuyInvalidQuantity()
    await testAccountCommandUsage()
    await testStockDownloadCommand()
}
