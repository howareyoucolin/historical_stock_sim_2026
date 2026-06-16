import fs from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'

import { DATA_DIRECTORY_NAME, normalizeStockCode, pathExists, validateStockCode, type SkippedStockActionResult } from './download-data'
import { EPS_FILE_NAME } from './build-data'

export const EPS_METRIC = 'TTM Net EPS'
export const EPS_SOURCE = 'Macrotrends'

// Macrotrends only accepts a request through a browser-like client.
const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

interface FetchedPage {
    html: string
    resolvedUrl: string
}

export interface ScrapeEpsPayload {
    stockCode: string
    metric: string
    source: string
    sourceUrl: string
    range: { start: string; end: string }
    epsByDate: Record<string, number>
}

export interface ScrapeEpsResult extends ScrapeEpsPayload {
    rowCount: number
    outputPath: string
    skipped: false
}

interface ScrapeEpsActionDependencies {
    cwd?: () => string
    fetchPage?: (url: string) => Promise<FetchedPage>
    fileExists?: (path: string) => Promise<boolean>
    makeDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>
}

// Build the Macrotrends PE-ratio URL for a stock; the slug is a placeholder
// because Macrotrends redirects any slug to the canonical company page.
export function getPeRatioUrl(stockCode: string): string {
    return `https://www.macrotrends.net/stocks/charts/${encodeURIComponent(stockCode)}/x/pe-ratio`
}

// Fetch a page over HTTPS, following redirects, and report the final URL so the
// resolved Macrotrends company page can be recorded as the data source.
function fetchPage(url: string): Promise<FetchedPage> {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/html' } }, (response) => {
                const { statusCode = 0, headers } = response

                if (statusCode >= 300 && statusCode < 400 && headers.location) {
                    response.resume()
                    const nextUrl = new URL(headers.location, url).toString()
                    void fetchPage(nextUrl).then(resolve).catch(reject)
                    return
                }

                if (statusCode !== 200) {
                    response.resume()
                    reject(new Error(`Macrotrends request failed with status ${statusCode}.`))
                    return
                }

                let rawData = ''

                response.setEncoding('utf8')
                response.on('data', (chunk) => {
                    rawData += chunk
                })
                response.on('end', () => {
                    resolve({ html: rawData, resolvedUrl: url })
                })
            })
            .on('error', (error) => {
                reject(new Error(`Macrotrends request failed: ${error.message}`))
            })
    })
}

// Read the plain text of each cell in a single table row.
function extractRowCells(rowHtml: string): string[] {
    return Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (match) => match[1].trim())
}

// Parse the "TTM Net EPS" column out of the Macrotrends PE-ratio table. Rows are
// keyed by date and column three carries the EPS; the live current-day row has
// no EPS yet, so rows without a reported value are skipped.
export function parseEpsByDate(html: string): Record<string, number> {
    const epsByDate: Record<string, number> = {}
    const rows = Array.from(html.matchAll(/<tr>([\s\S]*?)<\/tr>/g), (match) => match[1])

    for (const rowHtml of rows) {
        const cells = extractRowCells(rowHtml)

        if (cells.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) {
            continue
        }

        const epsText = cells[2].replace(/[$,]/g, '').trim()

        if (epsText === '') {
            continue
        }

        const eps = Number(epsText)

        if (Number.isFinite(eps)) {
            epsByDate[cells[0]] = eps
        }
    }

    return epsByDate
}

// Build the persisted JSON payload for a scraped EPS file.
export function buildEpsPayload(stockCode: string, epsByDate: Record<string, number>, sourceUrl: string): ScrapeEpsPayload {
    const dates = Object.keys(epsByDate).sort()

    if (dates.length === 0) {
        throw new Error('No TTM Net EPS data was found on the Macrotrends page.')
    }

    // Emit dates oldest-first to match the existing eps.json convention.
    const sortedEpsByDate: Record<string, number> = {}

    for (const date of dates) {
        sortedEpsByDate[date] = epsByDate[date]
    }

    return {
        stockCode,
        metric: EPS_METRIC,
        source: EPS_SOURCE,
        sourceUrl,
        range: { start: dates[0], end: dates[dates.length - 1] },
        epsByDate: sortedEpsByDate,
    }
}

// Create the reusable EPS scrape action so the CLI and UI can share it.
export function createScrapeEpsAction({
    cwd = process.cwd,
    fetchPage: fetchRemotePage = fetchPage,
    fileExists = pathExists,
    makeDirectory = fs.mkdir,
    writeFile = fs.writeFile,
}: ScrapeEpsActionDependencies = {}) {
    // Scrape a stock's TTM Net EPS series from Macrotrends and save it to the repo,
    // skipping the scrape when the EPS file already exists.
    return async function scrapeEpsAction(stockCode: string): Promise<ScrapeEpsResult | SkippedStockActionResult> {
        const normalizedStockCode = normalizeStockCode(stockCode)

        validateStockCode(normalizedStockCode)

        const repoRoot = cwd()
        const outputDirectory = path.join(repoRoot, DATA_DIRECTORY_NAME, normalizedStockCode)
        const outputPath = path.join(outputDirectory, EPS_FILE_NAME)

        if (await fileExists(outputPath)) {
            return { skipped: true, stockCode: normalizedStockCode, outputPath: path.relative(repoRoot, outputPath) }
        }

        const { html, resolvedUrl } = await fetchRemotePage(getPeRatioUrl(normalizedStockCode))
        const epsByDate = parseEpsByDate(html)
        const payload = buildEpsPayload(normalizedStockCode, epsByDate, resolvedUrl)

        await makeDirectory(outputDirectory, { recursive: true })
        await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

        return {
            ...payload,
            rowCount: Object.keys(payload.epsByDate).length,
            outputPath: path.relative(repoRoot, outputPath),
            skipped: false,
        }
    }
}

export const scrapeEpsAction = createScrapeEpsAction()
