import assert from 'node:assert/strict'

import { DATA_DIRECTORY_NAME } from './download-data'
import { EPS_FILE_NAME } from './build-data'
import { buildEpsPayload, createScrapeEpsAction, getPeRatioUrl, parseEpsByDate } from './scrape-eps'

// A trimmed copy of the Macrotrends PE-ratio table, including the live current-day
// row that reports a price but no EPS yet.
const SAMPLE_HTML = `
<table>
  <tr>
    <th>Date</th><th>Stock Price</th><th>TTM Net EPS</th><th>PE Ratio</th>
  </tr>
  <tr>
    <td style="text-align:center;">2026-06-15</td>
    <td style="text-align:center;">296.42</td>
    <td style="text-align:center;"></td>
    <td style="text-align:center;">35.89</td>
  </tr>
  <tr>
    <td style="text-align:center;">2026-03-31</td>
    <td style="text-align:center;">253.56</td>
    <td style="text-align:center;">$8.26</td>
    <td style="text-align:center;">30.70</td>
  </tr>
  <tr>
    <td style="text-align:center;">2025-12-31</td>
    <td style="text-align:center;">271.36</td>
    <td style="text-align:center;">$7.90</td>
    <td style="text-align:center;">34.35</td>
  </tr>
</table>`

// Verify the Macrotrends URL keeps the symbol and uses a placeholder slug.
function testGetPeRatioUrl(): void {
    const url = getPeRatioUrl('AAPL')

    assert.match(url, /macrotrends\.net\/stocks\/charts\/AAPL\/x\/pe-ratio$/)
}

// Verify the EPS column is parsed by date and the empty live row is skipped.
function testParseEpsByDate(): void {
    const epsByDate = parseEpsByDate(SAMPLE_HTML)

    assert.deepEqual(epsByDate, {
        '2026-03-31': 8.26,
        '2025-12-31': 7.9,
    })
    assert.equal('2026-06-15' in epsByDate, false)
}

// Verify the payload carries source metadata and a range spanning the reported dates.
function testBuildEpsPayload(): void {
    const payload = buildEpsPayload('AAPL', { '2025-12-31': 7.9, '2026-03-31': 8.26 }, 'https://example.test/pe-ratio')

    assert.equal(payload.stockCode, 'AAPL')
    assert.equal(payload.metric, 'TTM Net EPS')
    assert.equal(payload.source, 'Macrotrends')
    assert.equal(payload.sourceUrl, 'https://example.test/pe-ratio')
    assert.deepEqual(payload.range, { start: '2025-12-31', end: '2026-03-31' })
}

// Verify building a payload fails clearly when no EPS rows were found.
function testBuildEpsPayloadWithoutData(): void {
    assert.throws(() => buildEpsPayload('AAPL', {}, 'https://example.test/pe-ratio'), /No TTM Net EPS data/)
}

// Verify the action fetches the page, writes eps.json, and reports the saved file.
async function testScrapeEpsAction(): Promise<void> {
    const captured = {
        requestedUrl: null as string | null,
        mkdirPath: null as string | null,
        writePath: null as string | null,
        writeContents: null as string | null,
    }

    const scrapeEpsAction = createScrapeEpsAction({
        cwd: () => '/repo',
        fileExists: async () => false,
        fetchPage: async (url) => {
            captured.requestedUrl = url

            return { html: SAMPLE_HTML, resolvedUrl: 'https://www.macrotrends.net/stocks/charts/AAPL/apple/pe-ratio' }
        },
        makeDirectory: async (directoryPath) => {
            captured.mkdirPath = directoryPath
        },
        writeFile: async (filePath, contents) => {
            captured.writePath = filePath
            captured.writeContents = contents
        },
    })

    const result = await scrapeEpsAction('aapl')

    if (result.skipped) {
        assert.fail('expected the scrape to run when eps.json does not exist')
        return
    }

    const parsed = JSON.parse(captured.writeContents || '{}') as { epsByDate: Record<string, number> }

    assert.equal(result.stockCode, 'AAPL')
    assert.equal(result.rowCount, 2)
    assert.equal(result.source, 'Macrotrends')
    assert.equal(result.sourceUrl, 'https://www.macrotrends.net/stocks/charts/AAPL/apple/pe-ratio')
    assert.equal(result.outputPath, `${DATA_DIRECTORY_NAME}/AAPL/${EPS_FILE_NAME}`)
    assert.match(captured.requestedUrl || '', /charts\/AAPL\/x\/pe-ratio/)
    assert.equal(captured.mkdirPath, `/repo/${DATA_DIRECTORY_NAME}/AAPL`)
    assert.equal(captured.writePath, `/repo/${DATA_DIRECTORY_NAME}/AAPL/${EPS_FILE_NAME}`)
    assert.deepEqual(parsed.epsByDate, { '2026-03-31': 8.26, '2025-12-31': 7.9 })
}

// Verify the scrape is skipped without fetching when eps.json already exists.
async function testScrapeEpsActionSkipsExistingFile(): Promise<void> {
    let fetchWasCalled = false
    let writeWasCalled = false
    const scrapeEpsAction = createScrapeEpsAction({
        cwd: () => '/repo',
        fileExists: async () => true,
        fetchPage: async () => {
            fetchWasCalled = true
            return { html: SAMPLE_HTML, resolvedUrl: 'https://example.test/pe-ratio' }
        },
        writeFile: async () => {
            writeWasCalled = true
        },
    })

    const result = await scrapeEpsAction('aapl')

    assert.equal(result.skipped, true)
    assert.equal(result.stockCode, 'AAPL')
    assert.equal(result.outputPath, `${DATA_DIRECTORY_NAME}/AAPL/${EPS_FILE_NAME}`)
    assert.equal(fetchWasCalled, false)
    assert.equal(writeWasCalled, false)
}

// Run the focused action tests that protect the EPS scrape logic.
export async function runScrapeEpsActionTests(): Promise<void> {
    testGetPeRatioUrl()
    testParseEpsByDate()
    testBuildEpsPayload()
    testBuildEpsPayloadWithoutData()
    await testScrapeEpsAction()
    await testScrapeEpsActionSkipsExistingFile()
}
