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
    resolveDataRange,
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

// Verify the persisted JSON payload includes metadata plus keyed history data.
function testBuildHistoryPayload(): void {
    const payload = buildHistoryPayload('AAPL', {
        timestamp: [946684800],
        indicators: {
            quote: [
                {
                    close: [1.5],
                },
            ],
        },
    })

    assert.equal(payload.stockCode, 'AAPL')
    assert.equal(payload.source, 'Yahoo Finance')
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
        requestedUrl: null as string | null,
    }

    const downloadStockDataAction = createDownloadStockDataAction({
        cwd: () => '/repo',
        fileExists: async () => false,
        fetchRemoteJson: async (url) => {
            captured.requestedUrl = url

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

    if (result.skipped) {
        assert.fail('expected the download to run when history.json does not exist')
        return
    }

    const parsedContents = JSON.parse(captured.writeContents || '{}') as {
        stockCode: string
        historyByDate: Record<string, { close: number | null; isPayoutDate: boolean; dividendPerShare: number }>
    }

    assert.equal(result.stockCode, 'AAPL')
    assert.equal(result.source, 'Yahoo Finance')
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
    assert.deepEqual(parsedContents.historyByDate['2000-01-01'], {
        close: 1.5,
        isPayoutDate: true,
        dividendPerShare: 0.25,
    })
    assert.match(captured.requestedUrl || '', /chart\/AAPL\?/)
}

// Verify the download is skipped without fetching when history.json already exists.
async function testDownloadStockDataActionSkipsExistingFile(): Promise<void> {
    let fetchWasCalled = false
    let writeWasCalled = false
    const downloadStockDataAction = createDownloadStockDataAction({
        cwd: () => '/repo',
        fileExists: async () => true,
        fetchRemoteJson: async () => {
            fetchWasCalled = true
            return { chart: { result: [], error: null } }
        },
        writeFile: async () => {
            writeWasCalled = true
        },
    })

    const result = await downloadStockDataAction('aapl')

    assert.equal(result.skipped, true)
    assert.equal(result.stockCode, 'AAPL')
    assert.equal(result.outputPath, `${DATA_DIRECTORY_NAME}/AAPL/history.json`)
    assert.equal(fetchWasCalled, false)
    assert.equal(writeWasCalled, false)
}

// Run the focused action tests that protect the reusable stock download logic.
// Verify the download window resolves from config, falling back to defaults for missing/partial input.
function testResolveDataRange(): void {
    assert.deepEqual(resolveDataRange({ start: '2015-06-01', end: '2024-01-01' }), { start: '2015-06-01', end: '2024-01-01' })
    // A missing file (null) or partial config falls back per field to the built-in defaults.
    const defaults = resolveDataRange(null)
    assert.equal(defaults.start, '2010-01-01')
    assert.equal(defaults.end, '2026-01-01')
    assert.deepEqual(resolveDataRange({ end: '2030-01-01' }), { start: '2010-01-01', end: '2030-01-01' })
}

export async function runDownloadDataActionTests(): Promise<void> {
    testValidateStockCode()
    testResolveDataRange()
    testGetHistoryUrl()
    testBuildHistoryByDate()
    testBuildDividendMap()
    testBuildHistoryPayload()
    await testDownloadStockDataAction()
    await testDownloadStockDataActionSkipsExistingFile()
}
