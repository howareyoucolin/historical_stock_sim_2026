import { normalizeStockCode, validateStockCode } from './download-data'
import { fetchStockInfo, type StockProfilePayload } from './market-data-client'

export interface StockInfo {
    stockCode: string
    companyName: string
    segment: string
    industry: string
    summary: string
}

// Source of a stock's static profile; defaults to the market-data API but is injectable for tests.
export type StockInfoFetcher = (stockCode: string) => Promise<StockProfilePayload | null>

export interface StockInfoDependencies {
    getStockInfo?: StockInfoFetcher
}

// Build a safe fallback profile so an unknown ticker stays queryable rather than throwing.
function buildFallbackProfile(stockCode: string): StockInfo {
    return {
        stockCode,
        companyName: stockCode,
        segment: 'Unclassified',
        industry: 'Unclassified',
        summary: 'No profile is available for this ticker.',
    }
}

// Map a DB profile payload into the CLI-facing stock-info shape (segment == DB sector).
function normalizeProfile(stockCode: string, profile: StockProfilePayload): StockInfo {
    return {
        stockCode,
        companyName: profile.companyName ?? stockCode,
        segment: profile.sector ?? 'Unclassified',
        industry: profile.industry ?? 'Unclassified',
        summary: profile.description ?? '',
    }
}

// Resolve a ticker's static profile from the database, falling back to a placeholder when unknown.
// This is classification metadata (company/sector/industry), not time-series data, so it carries no
// hindsight risk and needs no simulation-date cap.
export async function buildStockInfo(stockCode: string, { getStockInfo = fetchStockInfo }: StockInfoDependencies = {}): Promise<StockInfo> {
    const normalizedStockCode = normalizeStockCode(stockCode)

    validateStockCode(normalizedStockCode)

    const profile = await getStockInfo(normalizedStockCode)

    return profile ? normalizeProfile(normalizedStockCode, profile) : buildFallbackProfile(normalizedStockCode)
}

// Format one stock profile into a compact CLI block that adds context beyond price data.
export function formatStockInfo(stockInfo: StockInfo): string {
    return [
        `${stockInfo.stockCode} info:`,
        `  company:  ${stockInfo.companyName}`,
        `  segment:  ${stockInfo.segment}`,
        `  industry: ${stockInfo.industry}`,
        `  summary:  ${stockInfo.summary || '-'}`,
    ].join('\n')
}

// Build the CLI-friendly stock-profile block for one ticker.
export async function showStockInfo(stockCode: string, dependencies: StockInfoDependencies = {}): Promise<string> {
    return formatStockInfo(await buildStockInfo(stockCode, dependencies))
}
