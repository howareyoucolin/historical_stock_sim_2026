import assert from 'node:assert/strict'

import { DEFAULT_ACCOUNT_DATE } from '../app/actions/account/model'
import { createRunCommand, getHelpText } from './commands'

// Verify the CLI help text advertises the shared account init command.
function testGetHelpText(): void {
    assert.match(getHelpText(), /account init/)
    assert.match(getHelpText(), /account show/)
    assert.match(getHelpText(), /account buy <code> <qty>/)
    assert.match(getHelpText(), /account sell <code> <qty>/)
    assert.match(getHelpText(), /account deposit <cash>/)
    assert.match(getHelpText(), /date next/)
    assert.match(getHelpText(), /date set <yyyy-mm-dd>/)
    assert.match(getHelpText(), /history show/)
    assert.match(getHelpText(), /stock download <code>/)
}

// Verify account init calls the shared session initializer and returns a short success message.
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
    assert.equal(result.output, 'Reset account in user-sessions/default.json.')
}

// Verify account show calls the shared account presenter and prints the terminal table output.
async function testAccountShowCommand(): Promise<void> {
    let showWasCalled = false
    const shownTable = [
        'Date: 2018-03-10',
        'Cash: 125.50',
        '',
        'stock_code | average_cost | current_price | quantity | total_value | total_gain_loss | percent_gain_loss',
    ].join('\n')
    const runCommand = createRunCommand({
        showDefaultUserAccount: async () => {
            showWasCalled = true

            return shownTable
        },
    })

    const result = await runCommand('account show')

    assert.equal(showWasCalled, true)
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, shownTable)
}

// Verify account deposit calls the shared session updater with the provided cash delta and returns a short success message.
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
    assert.equal(result.output, 'Updated account cash by -25.50 in user-sessions/default.json.')
}

// Verify account buy calls the shared purchase action with the provided stock code and quantity and returns a short success message.
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
    assert.equal(result.output, '3 stocks of AAPL successfully bought.')
}

// Verify account sell calls the shared sell action with the provided stock code and quantity and returns a short success message.
async function testAccountSellCommand(): Promise<void> {
    let capturedStockCode = ''
    let capturedQuantity = 0
    const runCommand = createRunCommand({
        sellStockInDefaultUserAccount: async (stockCode, quantity) => {
            capturedStockCode = stockCode
            capturedQuantity = quantity

            return {
                stockCode: 'AAPL',
                quantity: 2,
                pricePerShare: 12.5,
                totalProceeds: 25,
                account: {
                    date: DEFAULT_ACCOUNT_DATE,
                    cash: 1025,
                    positions: {},
                },
            }
        },
    })

    const result = await runCommand('account sell aapl 2')

    assert.equal(capturedStockCode, 'aapl')
    assert.equal(capturedQuantity, 2)
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, '2 stocks of AAPL successfully sold.')
}

// Verify invalid sell quantities are rejected before the shared sell action runs.
async function testAccountSellInvalidQuantity(): Promise<void> {
    let sellWasCalled = false
    const runCommand = createRunCommand({
        sellStockInDefaultUserAccount: async () => {
            sellWasCalled = true
            throw new Error('This should not run.')
        },
    })
    const result = await runCommand('account sell AAPL nope')

    assert.equal(sellWasCalled, false)
    assert.equal(result.exitCode, 1)
    assert.equal(result.output, 'Quantity must be a positive integer.')
}

// Verify history show calls the shared log presenter and prints its output verbatim.
async function testHistoryShowCommand(): Promise<void> {
    let showWasCalled = false
    const loggedHistory = '2026-06-16T14:23:01.123Z BUY stock=AAPL qty=3 price=105.35 cash=-316.05 sim=2016-01-04'
    const runCommand = createRunCommand({
        showHistoryLog: async () => {
            showWasCalled = true

            return loggedHistory
        },
    })

    const result = await runCommand('history show')

    assert.equal(showWasCalled, true)
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, loggedHistory)
}

// Verify bad history command arguments return the expected usage guidance.
async function testHistoryCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()
    const historyResult = await runCommand('history')
    const badHistoryResult = await runCommand('history wrong')
    const badShowResult = await runCommand('history show now')

    assert.equal(historyResult.exitCode, 1)
    assert.equal(historyResult.output, 'Usage: history show')
    assert.equal(badHistoryResult.exitCode, 1)
    assert.equal(badHistoryResult.output, 'Usage: history show')
    assert.equal(badShowResult.exitCode, 1)
    assert.equal(badShowResult.output, 'Usage: history show')
}

// Verify date next calls the shared simulation date advancer and returns the updated day.
async function testDateNextCommand(): Promise<void> {
    let nextWasCalled = false
    const runCommand = createRunCommand({
        setDefaultUserAccountDateToTomorrow: async () => {
            nextWasCalled = true

            return {
                date: '2016-01-05',
            }
        },
    })

    const result = await runCommand('date next')

    assert.equal(nextWasCalled, true)
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, 'Advanced simulation date to 2016-01-05.')
}

// Verify date set calls the shared simulation date setter and returns the updated day.
async function testDateSetCommand(): Promise<void> {
    let capturedSpecificDate = ''
    const runCommand = createRunCommand({
        setDefaultUserAccountDateToSpecificDate: async (specificDate) => {
            capturedSpecificDate = specificDate

            return {
                date: specificDate,
            }
        },
    })

    const result = await runCommand('date set 2018-04-02')

    assert.equal(capturedSpecificDate, '2018-04-02')
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, 'Set simulation date to 2018-04-02.')
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
    const accountResult = await runCommand('account')
    const badAccountResult = await runCommand('account wrong')
    const badShowResult = await runCommand('account show now')
    const badDepositResult = await runCommand('account deposit')
    const badBuyResult = await runCommand('account buy AAPL')
    const badSellResult = await runCommand('account sell AAPL')

    const expectedUsage = 'Usage: account <init|show|deposit <value_cash>|buy <stock_code> <quantity>|sell <stock_code> <quantity>>'

    assert.equal(accountResult.exitCode, 1)
    assert.equal(accountResult.output, expectedUsage)
    assert.equal(badAccountResult.exitCode, 1)
    assert.equal(badAccountResult.output, expectedUsage)
    assert.equal(badShowResult.exitCode, 1)
    assert.equal(badShowResult.output, 'Usage: account show')
    assert.equal(badDepositResult.exitCode, 1)
    assert.equal(badDepositResult.output, 'Usage: account deposit <value_cash>')
    assert.equal(badBuyResult.exitCode, 1)
    assert.equal(badBuyResult.output, 'Usage: account buy <stock_code> <quantity>')
    assert.equal(badSellResult.exitCode, 1)
    assert.equal(badSellResult.output, 'Usage: account sell <stock_code> <quantity>')
}

// Verify bad date command arguments return the expected usage guidance.
async function testDateCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()
    const dateResult = await runCommand('date')
    const badDateResult = await runCommand('date wrong')
    const badDateSetResult = await runCommand('date set')

    assert.equal(dateResult.exitCode, 1)
    assert.equal(dateResult.output, 'Usage: date next')
    assert.equal(badDateResult.exitCode, 1)
    assert.equal(badDateResult.output, 'Usage: date <next|set <yyyy-mm-dd>>')
    assert.equal(badDateSetResult.exitCode, 1)
    assert.equal(badDateSetResult.output, 'Usage: date set <yyyy-mm-dd>')
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
                range: { start: '2010-01-01', end: '2026-01-01' },
                historyByDate: {},
                rowCount: 42,
                outputPath: 'market-data/AAPL/history.json',
                skipped: false,
            }
        },
    })
    const result = await runCommand('stock download AAPL')

    assert.equal(requestedStockCode, 'AAPL')
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Downloaded 42 rows for AAPL\./)
}

// Verify stock build routes through the dedicated stock command handler.
async function testStockBuildCommand(): Promise<void> {
    let requestedStockCode = ''
    const runCommand = createRunCommand({
        buildStockData: async (stockCode) => {
            requestedStockCode = stockCode

            return {
                stockCode: 'AAPL',
                sources: {
                    priceHistory: { source: 'Yahoo Finance', file: 'history.json' },
                    eps: { source: 'Macrotrends', file: 'eps.json' },
                },
                range: { start: '2010-01-04', end: '2026-01-01' },
                fields: {},
                historyByDate: {},
                rowCount: 99,
                outputPath: 'market-data/AAPL/data.json',
                skipped: false,
            }
        },
    })
    const result = await runCommand('stock build AAPL')

    assert.equal(requestedStockCode, 'AAPL')
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Built 99 rows for AAPL\./)
}

// Verify stock scrape-eps routes through the dedicated stock command handler.
async function testStockScrapeEpsCommand(): Promise<void> {
    let requestedStockCode = ''
    const runCommand = createRunCommand({
        scrapeEps: async (stockCode) => {
            requestedStockCode = stockCode

            return {
                stockCode: 'AAPL',
                metric: 'TTM Net EPS',
                source: 'Macrotrends',
                sourceUrl: 'https://www.macrotrends.net/stocks/charts/AAPL/apple/pe-ratio',
                range: { start: '2006-12-31', end: '2026-03-31' },
                epsByDate: {},
                rowCount: 77,
                outputPath: 'market-data/AAPL/eps.json',
                skipped: false,
            }
        },
    })
    const result = await runCommand('stock scrape-eps AAPL')

    assert.equal(requestedStockCode, 'AAPL')
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Scraped 77 EPS rows for AAPL\./)
}

// Verify stock seed runs the watchlist action and reports a per-step summary with a failure exit code.
async function testStockSeedCommand(): Promise<void> {
    let seedWasCalled = false
    const runCommand = createRunCommand({
        seedWatchlist: async () => {
            seedWasCalled = true

            return {
                tickersFile: 'config/tickers.json',
                tickers: ['AAPL', 'MSFT'],
                results: [
                    { stockCode: 'AAPL', download: 'ok', scrapeEps: 'skipped', build: 'ok' },
                    { stockCode: 'MSFT', download: 'failed', scrapeEps: 'ok', build: 'ok' },
                ],
            }
        },
    })

    const result = await runCommand('stock seed')

    assert.equal(seedWasCalled, true)
    assert.match(result.output, /Seeded 2 tickers from config\/tickers.json\./)
    assert.match(result.output, /download\s+1 ok, 0 skipped, 1 failed/)
    // A failed step surfaces a non-zero exit code.
    assert.equal(result.exitCode, 1)
}

// Verify each stock command reports a skip message when the action returns a skipped result.
async function testStockCommandsReportSkips(): Promise<void> {
    const runCommand = createRunCommand({
        downloadStockData: async () => ({ skipped: true, stockCode: 'AAPL', outputPath: 'market-data/AAPL/history.json' }),
        scrapeEps: async () => ({ skipped: true, stockCode: 'AAPL', outputPath: 'market-data/AAPL/eps.json' }),
        buildStockData: async () => ({ skipped: true, stockCode: 'AAPL', outputPath: 'market-data/AAPL/data.json' }),
    })

    const downloadResult = await runCommand('stock download AAPL')
    const scrapeResult = await runCommand('stock scrape-eps AAPL')
    const buildResult = await runCommand('stock build AAPL')

    assert.equal(downloadResult.exitCode, 0)
    assert.equal(downloadResult.output, 'Skipped AAPL: market-data/AAPL/history.json already exists.')
    assert.equal(scrapeResult.output, 'Skipped AAPL: market-data/AAPL/eps.json already exists.')
    assert.equal(buildResult.output, 'Skipped AAPL: market-data/AAPL/data.json already exists.')
}

// Run the focused tests that protect CLI account command wiring.
export async function runCliCommandTests(): Promise<void> {
    testGetHelpText()
    await testAccountInitCommand()
    await testAccountShowCommand()
    await testAccountBuyCommand()
    await testAccountSellCommand()
    await testAccountDepositCommand()
    await testDateNextCommand()
    await testDateSetCommand()
    await testHistoryShowCommand()
    await testHistoryCommandUsage()
    await testAccountDepositInvalidValue()
    await testAccountBuyInvalidQuantity()
    await testAccountSellInvalidQuantity()
    await testAccountCommandUsage()
    await testDateCommandUsage()
    await testStockDownloadCommand()
    await testStockScrapeEpsCommand()
    await testStockBuildCommand()
    await testStockSeedCommand()
    await testStockCommandsReportSkips()
}
