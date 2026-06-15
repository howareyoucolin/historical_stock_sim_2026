import assert from 'node:assert/strict'

import {
    DATA_DIRECTORY_NAME,
    END_DATE,
    START_DATE,
    buildDividendMap,
    buildHistoryByDate,
    buildHistoryPayload,
    createDownloadStockDataAction,
    getHistoryUrl,
    getPeRatio,
    getQuoteUrl,
    validateStockCode,
} from './download-data'

// Verify stock code validation rejects symbols that are unsafe for requests.
function testValidateStockCode(): void {
    assert.throws(() => validateStockCode('AAPL/../../etc'), /letters, numbers, dots, and dashes/)
}

// Verify the Yahoo Finance URL keeps the expected symbol and date window.
function testGetHistoryUrl(): void {
    const url = getHistoryUrl('AAPL')

    assert.match(url, /chart\/AAPL\?/)
    assert.match(url, /period1=/)
    assert.match(url, /period2=/)
    assert.match(url, /interval=1d/)
}

// Verify the Yahoo Finance quote URL requests the current symbol snapshot used for fundamentals.
function testGetQuoteUrl(): void {
    const url = getQuoteUrl('AAPL')

    assert.equal(url, 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL')
}

// Verify history data is generated as a date-keyed lookup for fast reads.
function testBuildHistoryByDate(): void {
    const historyByDate = buildHistoryByDate({
        timestamp: [946684800],
        indicators: {
            quote: [
                {
                    close: [1.5],
                },
            ],
        },
    })

    assert.deepEqual(historyByDate, {
        '2000-01-01': {
            close: 1.5,
            isPayoutDate: false,
            dividendPerShare: 0,
        },
    })
}

// Verify dividend events are mapped onto the matching history dates.
function testBuildDividendMap(): void {
    const dividendMap = buildDividendMap({
        events: {
            dividends: {
                1: { amount: 0.25, date: 946684800 },
                2: { amount: 0.1, date: 946684800 },
            },
        },
    })

    assert.equal(dividendMap.get('2000-01-01'), 0.35)
}

// Verify the quote payload extracts the trailing PE ratio and falls back to null when it is missing.
function testGetPeRatio(): void {
    assert.equal(
        getPeRatio({
            quoteResponse: {
                result: [{ trailingPE: 31.25 }],
            },
        }),
        31.25
    )
    assert.equal(
        getPeRatio({
            quoteResponse: {
                result: [{}],
            },
        }),
        null
    )
}

// Verify the persisted JSON payload includes metadata plus keyed history data.
function testBuildHistoryPayload(): void {
    const payload = buildHistoryPayload(
        'AAPL',
        {
            timestamp: [946684800],
            indicators: {
                quote: [
                    {
                        close: [1.5],
                    },
                ],
            },
        },
        31.25
    )

    assert.equal(payload.stockCode, 'AAPL')
    assert.equal(payload.source, 'Yahoo Finance')
    assert.equal(payload.peRatio, 31.25)
    assert.deepEqual(payload.range, { start: START_DATE, end: END_DATE })
    assert.equal(Object.keys(payload.historyByDate).length, 1)
    assert.deepEqual(payload.historyByDate['2000-01-01'], {
        close: 1.5,
        isPayoutDate: false,
        dividendPerShare: 0,
    })
}

// Verify the action writes normalized stock data into the shared market-data folder.
async function testDownloadStockDataAction(): Promise<void> {
    const captured = {
        mkdirPath: null as string | null,
        mkdirOptions: null as { recursive?: boolean } | null,
        writePath: null as string | null,
        writeContents: null as string | null,
        writeEncoding: null as BufferEncoding | null,
        requestedUrls: [] as string[],
    }

    const downloadStockDataAction = createDownloadStockDataAction({
        cwd: () => '/repo',
        fetchRemoteJson: async (url) => {
            captured.requestedUrls.push(url)

            if (url.includes('/chart/')) {
                return {
                    chart: {
                        result: [
                            {
                                timestamp: [946684800],
                                events: {
                                    dividends: {
                                        1: { amount: 0.25, date: 946684800 },
                                    },
                                },
                                indicators: {
                                    quote: [
                                        {
                                            close: [1.5],
                                        },
                                    ],
                                },
                            },
                        ],
                        error: null,
                    },
                }
            }

            return {
                quoteResponse: {
                    result: [{ trailingPE: 31.25 }],
                },
            }
        },
        makeDirectory: async (directoryPath, options) => {
            captured.mkdirPath = directoryPath
            captured.mkdirOptions = options || null
        },
        writeFile: async (filePath, contents, encoding) => {
            captured.writePath = filePath
            captured.writeContents = contents
            captured.writeEncoding = encoding
        },
    })

    const result = await downloadStockDataAction('aapl')
    const parsedContents = JSON.parse(captured.writeContents || '{}') as {
        stockCode: string
        peRatio: number | null
        historyByDate: Record<string, { close: number | null; isPayoutDate: boolean; dividendPerShare: number }>
    }

    assert.equal(result.stockCode, 'AAPL')
    assert.equal(result.source, 'Yahoo Finance')
    assert.equal(result.peRatio, 31.25)
    assert.equal(result.rowCount, 1)
    assert.equal(result.outputPath, `${DATA_DIRECTORY_NAME}/AAPL/history.json`)
    assert.deepEqual(result.range, { start: START_DATE, end: END_DATE })
    assert.deepEqual(result.historyByDate['2000-01-01'], {
        close: 1.5,
        isPayoutDate: true,
        dividendPerShare: 0.25,
    })
    assert.equal(captured.mkdirPath, `/repo/${DATA_DIRECTORY_NAME}/AAPL`)
    assert.deepEqual(captured.mkdirOptions, { recursive: true })
    assert.equal(captured.writePath, `/repo/${DATA_DIRECTORY_NAME}/AAPL/history.json`)
    assert.equal(captured.writeEncoding, 'utf8')
    assert.equal(parsedContents.stockCode, 'AAPL')
    assert.equal(parsedContents.peRatio, 31.25)
    assert.deepEqual(parsedContents.historyByDate['2000-01-01'], {
        close: 1.5,
        isPayoutDate: true,
        dividendPerShare: 0.25,
    })
    assert.equal(captured.requestedUrls.length, 2)
    assert.match(captured.requestedUrls[0] || '', /chart\/AAPL\?/)
    assert.equal(captured.requestedUrls[1], 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL')
}

// Run the focused action tests that protect the reusable stock download logic.
export async function runDownloadDataActionTests(): Promise<void> {
    testValidateStockCode()
    testGetHistoryUrl()
    testGetQuoteUrl()
    testBuildHistoryByDate()
    testBuildDividendMap()
    testGetPeRatio()
    testBuildHistoryPayload()
    await testDownloadStockDataAction()
}
