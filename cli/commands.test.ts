import assert from 'node:assert/strict'

import { DEFAULT_ACCOUNT_DATE } from '../app/actions/account/model'
import { createRunCommand, getHelpText, tokenizeCommand } from './commands'

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
    assert.match(getHelpText(), /report build/)
    assert.match(getHelpText(), /stock download <code>/)
    assert.match(getHelpText(), /stock history <code>/)
    assert.match(getHelpText(), /stock info <code>/)
    assert.match(getHelpText(), /stock status <code>/)
    assert.match(getHelpText(), /stock list/)
}

// Verify the tokenizer splits on whitespace but keeps quoted spans (quotes stripped) as one token.
function testTokenizeCommand(): void {
    assert.deepEqual(tokenizeCommand('account buy AAPL 3'), ['account', 'buy', 'AAPL', '3'])
    assert.deepEqual(tokenizeCommand('account buy AAPL 3 --note="buy the dip"'), ['account', 'buy', 'AAPL', '3', '--note=buy the dip'])
    assert.deepEqual(tokenizeCommand("account buy AAPL 3 --note='hold long'"), ['account', 'buy', 'AAPL', '3', '--note=hold long'])
    assert.deepEqual(tokenizeCommand('   '), [])
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
    assert.equal(result.output, 'Reset account in user-sessions/account.json.')
}

// Verify account show fetches the holdings view, renders the table, and carries the view as data.
async function testAccountShowCommand(): Promise<void> {
    let fetchWasCalled = false
    const view = {
        account: { date: '2018-03-10', cash: 125.5, positions: {} },
        rows: [],
        summary: { principal: 0, totalCurrentValue: 0, totalGainLoss: 0, percentGainLoss: 0, totalDayChange: 0, dayChangePercent: 0 },
    }
    const runCommand = createRunCommand({
        fetchAccountView: async () => {
            fetchWasCalled = true

            return view
        },
    })

    const result = await runCommand('account show')

    assert.equal(fetchWasCalled, true)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Date: 2018-03-10/)
    assert.match(result.output, /Cash: 125.50/)
    assert.equal(result.data, view)
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
    assert.equal(result.output, 'Updated account cash by -25.50 in user-sessions/account.json.')
}

// Verify account deposit forwards a --note to the session updater and echoes it on the JSON payload.
async function testAccountDepositCommandWithNote(): Promise<void> {
    let capturedNote: string | undefined
    const runCommand = createRunCommand({
        depositIntoDefaultUserAccount: async (valueCash, note) => {
            capturedNote = note

            return { date: '2018-03-10', cash: valueCash, positions: {} }
        },
    })

    const result = await runCommand('account deposit 2500 --note="Monthly recurring contribution" --json')

    assert.equal(result.exitCode, 0)
    assert.equal(capturedNote, 'Monthly recurring contribution')
    assert.equal(JSON.parse(result.output).note, 'Monthly recurring contribution')
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

// Verify a quoted --note flag is parsed into one token and forwarded to the buy action, leaving the
// positional stock code and quantity intact.
async function testAccountBuyCommandWithNote(): Promise<void> {
    let capturedStockCode = ''
    let capturedQuantity = 0
    let capturedNote: string | undefined = 'unset'
    const runCommand = createRunCommand({
        buyStockInDefaultUserAccount: async (stockCode, quantity, _dependencies, note) => {
            capturedStockCode = stockCode
            capturedQuantity = quantity
            capturedNote = note

            return {
                stockCode: 'AAPL',
                quantity: 3,
                costPerShare: 10.5,
                totalCost: 31.5,
                account: { date: DEFAULT_ACCOUNT_DATE, cash: 968.5, positions: {} },
            }
        },
    })

    const result = await runCommand('account buy AAPL 3 --note="buy the dip"')

    assert.equal(capturedStockCode, 'AAPL')
    assert.equal(capturedQuantity, 3)
    assert.equal(capturedNote, 'buy the dip')
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, '3 stocks of AAPL successfully bought.')
}

// Verify selling without a note forwards an undefined note, so the flag stays optional.
async function testAccountSellCommandWithoutNote(): Promise<void> {
    let capturedNote: string | undefined = 'unset'
    const runCommand = createRunCommand({
        sellStockInDefaultUserAccount: async (stockCode, quantity, _dependencies, note) => {
            capturedNote = note

            return {
                stockCode: 'AAPL',
                quantity: 2,
                pricePerShare: 12.5,
                totalProceeds: 25,
                account: { date: DEFAULT_ACCOUNT_DATE, cash: 1025, positions: {} },
            }
        },
    })

    const result = await runCommand('account sell AAPL 2')

    assert.equal(capturedNote, undefined)
    assert.equal(result.exitCode, 0)
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
        readHistoryEntries: async () => {
            showWasCalled = true

            return [loggedHistory]
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
    const badFilterResult = await runCommand('history show now')

    assert.equal(historyResult.exitCode, 1)
    assert.match(historyResult.output, /Usage: history show/)
    assert.equal(badHistoryResult.exitCode, 1)
    assert.match(badHistoryResult.output, /Usage: history show/)
    assert.equal(badFilterResult.exitCode, 1)
    assert.equal(badFilterResult.output, 'Unknown history filter: now')
}

// Verify report build routes through the dedicated report command handler and carries the built report as JSON data.
async function testReportBuildCommand(): Promise<void> {
    let capturedOptions: Record<string, unknown> | null = null
    const runCommand = createRunCommand({
        buildReport: async (options) => {
            capturedOptions = options as Record<string, unknown>

            return {
                outputPath: 'user-sessions/report.json',
                report: {
                    reportVersion: 1,
                    sessionId: 'default',
                },
            }
        },
    })

    const result = await runCommand(
        'report build --strategy="Quality Pullback Rotation" --objective="Compound capital" --objective-constraint="max 10 positions" --market-regime=bull --volatility-level=medium --note="learning run"'
    )

    assert.deepEqual(capturedOptions, {
        strategyName: 'Quality Pullback Rotation',
        objectiveTitle: 'Compound capital',
        objectiveConstraints: ['max 10 positions'],
        marketRegime: 'bull',
        volatilityLevel: 'medium',
        note: 'learning run',
    })
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, 'Built report at user-sessions/report.json.')
    assert.deepEqual(result.data, { reportVersion: 1, sessionId: 'default' })
}

// Verify bad report command arguments return the expected usage guidance.
async function testReportCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()
    const reportResult = await runCommand('report')
    const badReportResult = await runCommand('report wrong')
    const badFlagResult = await runCommand('report build --nope')

    assert.equal(reportResult.exitCode, 1)
    assert.match(reportResult.output, /^Usage: report build/)
    assert.equal(badReportResult.exitCode, 1)
    assert.match(badReportResult.output, /^Usage: report build/)
    assert.equal(badFlagResult.exitCode, 1)
    assert.equal(badFlagResult.output, 'Unknown report flag: --nope')
}

// Verify date next steps one trading day and reports the updated day.
async function testDateNextCommand(): Promise<void> {
    let nextCallCount = 0
    const runCommand = createRunCommand({
        advanceOneTradingDay: async () => {
            nextCallCount += 1

            return { account: { date: '2016-01-05', cash: 0, positions: {} }, dividends: [], totalDividends: 0 }
        },
    })

    const result = await runCommand('date next')

    assert.equal(nextCallCount, 1)
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, 'Advanced simulation date to 2016-01-05.')
}

// Verify date next <n> steps n trading days and surfaces dividends credited along the way.
async function testDateNextMultipleCommand(): Promise<void> {
    let nextCallCount = 0
    const runCommand = createRunCommand({
        advanceOneTradingDay: async () => {
            nextCallCount += 1

            return {
                account: { date: `2016-01-0${4 + nextCallCount}`, cash: 0, positions: {} },
                dividends: nextCallCount === 2 ? [{ stockCode: 'T', date: '2016-01-06', shares: 10, perShare: 0.5, amount: 5 }] : [],
                totalDividends: nextCallCount === 2 ? 5 : 0,
            }
        },
    })

    const result = await runCommand('date next 3')

    assert.equal(nextCallCount, 3)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Advanced 3 trading days to 2016-01-07\./)
    assert.match(result.output, /Credited 5.00 in dividends across 1 payout\./)
}

// Verify date set advances to a target day and returns the updated day.
async function testDateSetCommand(): Promise<void> {
    let capturedSpecificDate = ''
    const runCommand = createRunCommand({
        advanceToSpecificDate: async (specificDate) => {
            capturedSpecificDate = specificDate

            return { account: { date: specificDate, cash: 0, positions: {} }, dividends: [], totalDividends: 0 }
        },
    })

    const result = await runCommand('date set 2018-04-02')

    assert.equal(capturedSpecificDate, '2018-04-02')
    assert.equal(result.exitCode, 0)
    assert.equal(result.output, 'Set simulation date to 2018-04-02.')
}

// Verify date show reports the current simulation date without changing it.
async function testDateShowCommand(): Promise<void> {
    const runCommand = createRunCommand({
        fetchAccountSession: async () => ({ date: '2020-02-14', cash: 0, positions: {} }),
    })

    const result = await runCommand('date show')

    assert.equal(result.exitCode, 0)
    assert.equal(result.output, 'Simulation date: 2020-02-14.')
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
    assert.equal(badDepositResult.output, 'Usage: account deposit <value_cash> [--note=<text>]')
    assert.equal(badBuyResult.exitCode, 1)
    assert.match(badBuyResult.output, /^Usage: account buy <stock_code> <quantity\|--amount=<dollars>\|max>/)
    assert.equal(badSellResult.exitCode, 1)
    assert.match(badSellResult.output, /^Usage: account sell <stock_code> <quantity\|all\|--percent=<pct>>/)
}

// Verify bad date command arguments return the expected usage guidance.
async function testDateCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()
    const dateResult = await runCommand('date')
    const badDateResult = await runCommand('date wrong')
    const badDateSetResult = await runCommand('date set')

    assert.equal(dateResult.exitCode, 1)
    assert.equal(dateResult.output, 'Usage: date <show|next [n]|set <yyyy-mm-dd>>')
    assert.equal(badDateResult.exitCode, 1)
    assert.equal(badDateResult.output, 'Usage: date <show|next [n]|set <yyyy-mm-dd>>')
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

// Verify stock history routes through the dedicated stock command handler with the requested code.
async function testStockHistoryCommand(): Promise<void> {
    let requestedStockCode = ''
    const runCommand = createRunCommand({
        fetchStockHistory: async (stockCode) => {
            requestedStockCode = stockCode

            return {
                stockCode: 'AAPL',
                throughDate: '2020-02-14',
                rows: [{ date: '2010-01-04', close: 7.64, ttmEps: 0.37, peRatio: 20.66, dividendPerShare: 0, isPayoutDate: false }],
            }
        },
    })

    const result = await runCommand('stock history AAPL')

    assert.equal(requestedStockCode, 'AAPL')
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /History for AAPL from 2010-01-04 to 2020-02-14/)
}

// Verify stock history without a code reports its usage line and a non-zero exit code.
async function testStockHistoryCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()

    const result = await runCommand('stock history')

    assert.equal(result.exitCode, 1)
    assert.equal(result.output, 'Usage: stock history <code>')
}

// Verify stock info routes through the dedicated stock command handler with the requested code.
async function testStockInfoCommand(): Promise<void> {
    let requestedStockCode = ''
    const runCommand = createRunCommand({
        fetchStockInfo: async (stockCode) => {
            requestedStockCode = stockCode

            return {
                stockCode: 'AAPL',
                companyName: 'Apple Inc.',
                segment: 'Information Technology',
                industry: 'Technology Hardware, Storage & Peripherals',
                summary: 'Consumer-facing technology platforms, devices, and digital ecosystems.',
            }
        },
    })

    const result = await runCommand('stock info AAPL')

    assert.equal(requestedStockCode, 'AAPL')
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /AAPL info:/)
    assert.match(result.output, /company:\s+Apple Inc\./)
    assert.match(result.output, /industry: Technology Hardware/)
}

// Verify stock info without a code reports its usage line and a non-zero exit code.
async function testStockInfoCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()

    const result = await runCommand('stock info')

    assert.equal(result.exitCode, 1)
    assert.equal(result.output, 'Usage: stock info <code>')
}

// Verify stock status routes through the dedicated stock command handler with the requested code.
async function testStockStatusCommand(): Promise<void> {
    let requestedStockCode = ''
    const runCommand = createRunCommand({
        fetchStockStatus: async (stockCode) => {
            requestedStockCode = stockCode

            return {
                stockCode: 'AAPL',
                simDate: '2020-02-14',
                asOfDate: '2020-02-14',
                row: { date: '2020-02-14', close: 81.24, ttmEps: 3.18, peRatio: 25.55, dividendPerShare: 0, isPayoutDate: false },
                previousClose: 81.22,
            }
        },
    })

    const result = await runCommand('stock status AAPL')

    assert.equal(requestedStockCode, 'AAPL')
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /AAPL status on 2020-02-14:/)
}

// Verify stock status without a code reports its usage line and a non-zero exit code.
async function testStockStatusCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()

    const result = await runCommand('stock status')

    assert.equal(result.exitCode, 1)
    assert.equal(result.output, 'Usage: stock status <code>')
}

// Verify stock list routes through the dedicated stock command handler.
async function testStockListCommand(): Promise<void> {
    let listWasCalled = false
    const runCommand = createRunCommand({
        fetchStockList: async () => {
            listWasCalled = true

            return ['AAPL', 'MSFT']
        },
    })

    const result = await runCommand('stock list')

    assert.equal(listWasCalled, true)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /2 stocks available:/)
}

// Verify stock list rejects extra arguments with its usage line and a non-zero exit code.
async function testStockListCommandUsage(): Promise<void> {
    const runCommand = createRunCommand()

    const result = await runCommand('stock list AAPL')

    assert.equal(result.exitCode, 1)
    assert.equal(result.output, 'Usage: stock list')
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

// Verify --json renders the command's structured data instead of the human output.
async function testJsonModeRendersData(): Promise<void> {
    const runCommand = createRunCommand({
        fetchAccountSession: async () => ({ date: '2020-02-14', cash: 0, positions: {} }),
    })

    const result = await runCommand('date show --json')

    assert.equal(result.exitCode, 0)
    assert.deepEqual(JSON.parse(result.output), { date: '2020-02-14' })
}

// Verify --json results are flagged for verbatim rendering and carry no ANSI color codes, so machine
// consumers parse clean JSON instead of color-wrapped text.
async function testJsonModeOutputIsUncolored(): Promise<void> {
    const runCommand = createRunCommand({
        fetchAccountSession: async () => ({ date: '2020-02-14', cash: 0, positions: {} }),
    })

    const result = await runCommand('date show --json')

    assert.equal(result.json, true)
    assert.ok(!result.output.includes('\u001b'), 'JSON output must not contain ANSI escape codes')
}

// Verify --json wraps a plain-message command (no structured data) as a message object.
async function testJsonModeWrapsMessage(): Promise<void> {
    const runCommand = createRunCommand()

    const result = await runCommand('help --json')

    assert.equal(result.exitCode, 0)
    assert.ok(typeof JSON.parse(result.output).message === 'string')
}

// Verify a dollar --amount buy sizes the order from the quoted price (floor of amount / price).
async function testAccountBuyByAmount(): Promise<void> {
    let capturedQuantity = 0
    const runCommand = createRunCommand({
        quoteStockForAccountDate: async () => ({ stockCode: 'AAPL', date: '2020-02-14', close: 80 }),
        buyStockInDefaultUserAccount: async (stockCode, quantity) => {
            capturedQuantity = quantity

            return { stockCode: 'AAPL', quantity, costPerShare: 80, totalCost: 80 * quantity, account: { date: '2020-02-14', cash: 0, positions: {} } }
        },
    })

    const result = await runCommand('account buy AAPL --amount=500')

    // 500 / 80 = 6.25 -> 6 shares.
    assert.equal(capturedQuantity, 6)
    assert.equal(result.exitCode, 0)
}

// Verify `max` buys as many shares as available cash allows at the quoted price.
async function testAccountBuyMax(): Promise<void> {
    let capturedQuantity = 0
    const runCommand = createRunCommand({
        fetchAccountView: async () => ({
            account: { date: '2020-02-14', cash: 1000, positions: {} },
            rows: [],
            summary: { principal: 0, totalCurrentValue: 0, totalGainLoss: 0, percentGainLoss: 0, totalDayChange: 0, dayChangePercent: 0 },
        }),
        quoteStockForAccountDate: async () => ({ stockCode: 'AAPL', date: '2020-02-14', close: 80 }),
        buyStockInDefaultUserAccount: async (stockCode, quantity) => {
            capturedQuantity = quantity

            return { stockCode: 'AAPL', quantity, costPerShare: 80, totalCost: 80 * quantity, account: { date: '2020-02-14', cash: 1000 - 80 * quantity, positions: {} } }
        },
    })

    const result = await runCommand('account buy AAPL max')

    // 1000 / 80 = 12.5 -> 12 shares.
    assert.equal(capturedQuantity, 12)
    assert.equal(result.exitCode, 0)
}

// Verify --dry-run previews a buy without invoking the purchase action.
async function testAccountBuyDryRun(): Promise<void> {
    let buyWasCalled = false
    const runCommand = createRunCommand({
        quoteStockForAccountDate: async () => ({ stockCode: 'AAPL', date: '2020-02-14', close: 80 }),
        buyStockInDefaultUserAccount: async () => {
            buyWasCalled = true
            throw new Error('should not run in dry run')
        },
    })

    const result = await runCommand('account buy AAPL 3 --dry-run')

    assert.equal(buyWasCalled, false)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Dry run: would buy 3 AAPL at 80.00 = 240.00/)
}

// Verify `sell all` sells the full owned quantity for the stock.
async function testAccountSellAll(): Promise<void> {
    let capturedQuantity = 0
    const runCommand = createRunCommand({
        fetchAccountView: async () => ({
            account: { date: '2020-02-14', cash: 0, positions: { AAPL: [{ quantity: 7, cost_per_share: 10, purchase_date: '2016-01-05' }] } },
            rows: [],
            summary: { principal: 0, totalCurrentValue: 0, totalGainLoss: 0, percentGainLoss: 0, totalDayChange: 0, dayChangePercent: 0 },
        }),
        sellStockInDefaultUserAccount: async (stockCode, quantity) => {
            capturedQuantity = quantity

            return { stockCode: 'AAPL', quantity, pricePerShare: 80, totalProceeds: 80 * quantity, account: { date: '2020-02-14', cash: 80 * quantity, positions: {} } }
        },
    })

    const result = await runCommand('account sell AAPL all')

    assert.equal(capturedQuantity, 7)
    assert.equal(result.exitCode, 0)
}

// Verify --percent sells the floored fraction of owned shares.
async function testAccountSellPercent(): Promise<void> {
    let capturedQuantity = 0
    const runCommand = createRunCommand({
        fetchAccountView: async () => ({
            account: { date: '2020-02-14', cash: 0, positions: { AAPL: [{ quantity: 10, cost_per_share: 10, purchase_date: '2016-01-05' }] } },
            rows: [],
            summary: { principal: 0, totalCurrentValue: 0, totalGainLoss: 0, percentGainLoss: 0, totalDayChange: 0, dayChangePercent: 0 },
        }),
        sellStockInDefaultUserAccount: async (stockCode, quantity) => {
            capturedQuantity = quantity

            return { stockCode: 'AAPL', quantity, pricePerShare: 80, totalProceeds: 80 * quantity, account: { date: '2020-02-14', cash: 80 * quantity, positions: {} } }
        },
    })

    const result = await runCommand('account sell AAPL --percent=50')

    assert.equal(capturedQuantity, 5)
    assert.equal(result.exitCode, 0)
}

// Verify history filters keep only entries matching the requested type.
async function testHistoryTypeFilter(): Promise<void> {
    const runCommand = createRunCommand({
        readHistoryEntries: async () => [
            '2026-06-16T00:00:00.000Z BUY stock=AAPL qty=3 price=10.00 cash=-30.00 sim=2020-02-14',
            '2026-06-16T00:00:01.000Z DEPOSIT cash=+1000.00 sim=2020-02-14',
            '2026-06-16T00:00:02.000Z SELL stock=AAPL qty=1 price=12.00 cash=+12.00 sim=2020-02-15',
        ],
    })

    const result = await runCommand('history show --type=sell')

    assert.equal(result.exitCode, 0)
    assert.match(result.output, /SELL stock=AAPL/)
    assert.doesNotMatch(result.output, /BUY|DEPOSIT/)
}

// Verify values show renders the return summary and carries the structured summary as data.
async function testValuesShowCommand(): Promise<void> {
    const summary = {
        snapshots: [{ date: '2020-02-14', value: 1000 }, { date: '2020-02-18', value: 1100 }],
        count: 2,
        first: { date: '2020-02-14', value: 1000 },
        last: { date: '2020-02-18', value: 1100 },
        change: 100,
        changePercent: 10,
        high: { date: '2020-02-18', value: 1100 },
        low: { date: '2020-02-14', value: 1000 },
    }
    const runCommand = createRunCommand({ fetchValuesSummary: async () => summary })

    const result = await runCommand('values show')

    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Return: \+100.00 \(\+10.00%\)/)
    assert.equal(result.data, summary)
}

// Verify stock price prints a one-line quote with the day change for the account date.
async function testStockPriceCommand(): Promise<void> {
    const runCommand = createRunCommand({
        fetchStockStatus: async () => ({
            stockCode: 'AAPL',
            simDate: '2020-02-14',
            asOfDate: '2020-02-14',
            row: { date: '2020-02-14', close: 81.24, ttmEps: 3.18, peRatio: 25.55, dividendPerShare: 0, isPayoutDate: false },
            previousClose: 80,
        }),
    })

    const result = await runCommand('stock price AAPL')

    assert.equal(result.exitCode, 0)
    assert.match(result.output, /AAPL 81.24 USD on 2020-02-14 \+1.24/)
}

// Verify stock compare tabulates each requested code using the status builder.
async function testStockCompareCommand(): Promise<void> {
    const byCode: Record<string, number> = { AAPL: 81.24, MSFT: 187.5 }
    const runCommand = createRunCommand({
        fetchStockStatus: async (stockCode) => ({
            stockCode,
            simDate: '2020-02-14',
            asOfDate: '2020-02-14',
            row: { date: '2020-02-14', close: byCode[stockCode], ttmEps: 3, peRatio: 27, dividendPerShare: 0, isPayoutDate: false },
            previousClose: 80,
        }),
    })

    const result = await runCommand('stock compare AAPL MSFT')

    assert.equal(result.exitCode, 0)
    assert.match(result.output, /stock\s+\|\s+close/)
    assert.match(result.output, /AAPL/)
    assert.match(result.output, /MSFT/)
}

// Run the focused tests that protect CLI account command wiring.
export async function runCliCommandTests(): Promise<void> {
    testGetHelpText()
    testTokenizeCommand()
    await testAccountInitCommand()
    await testAccountShowCommand()
    await testAccountBuyCommand()
    await testAccountBuyCommandWithNote()
    await testAccountSellCommand()
    await testAccountSellCommandWithoutNote()
    await testAccountDepositCommand()
    await testAccountDepositCommandWithNote()
    await testDateNextCommand()
    await testDateNextMultipleCommand()
    await testDateSetCommand()
    await testDateShowCommand()
    await testHistoryShowCommand()
    await testHistoryCommandUsage()
    await testReportBuildCommand()
    await testReportCommandUsage()
    await testAccountDepositInvalidValue()
    await testAccountBuyInvalidQuantity()
    await testAccountSellInvalidQuantity()
    await testAccountCommandUsage()
    await testDateCommandUsage()
    await testStockDownloadCommand()
    await testStockScrapeEpsCommand()
    await testStockBuildCommand()
    await testStockHistoryCommand()
    await testStockHistoryCommandUsage()
    await testStockInfoCommand()
    await testStockInfoCommandUsage()
    await testStockStatusCommand()
    await testStockStatusCommandUsage()
    await testStockListCommand()
    await testStockListCommandUsage()
    await testStockSeedCommand()
    await testStockCommandsReportSkips()
    await testJsonModeRendersData()
    await testJsonModeWrapsMessage()
    await testJsonModeOutputIsUncolored()
    await testAccountBuyByAmount()
    await testAccountBuyMax()
    await testAccountBuyDryRun()
    await testAccountSellAll()
    await testAccountSellPercent()
    await testHistoryTypeFilter()
    await testValuesShowCommand()
    await testStockPriceCommand()
    await testStockCompareCommand()
}
