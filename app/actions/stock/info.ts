import { STOCK_PROFILES, type StockProfile } from './info-data'
import { normalizeStockCode, validateStockCode } from './download-data'

export interface StockInfo {
    stockCode: string
    companyName: string
    segment: string
    summary: string
    listingStatus: string
    dataNote: string | null
}

// Build a safe fallback profile so newly added tickers remain queryable even before curation catches up.
function buildFallbackProfile(stockCode: string): StockInfo {
    return {
        stockCode,
        companyName: stockCode,
        segment: 'Unclassified',
        summary: 'No curated profile is stored for this ticker yet.',
        listingStatus: 'Unknown / not yet curated',
        dataNote: null,
    }
}

// Normalize one curated profile record into the CLI-facing stock-info shape.
function normalizeProfile(stockCode: string, profile: StockProfile): StockInfo {
    return {
        stockCode,
        companyName: profile.companyName,
        segment: profile.segment,
        summary: profile.summary,
        listingStatus: profile.listingStatus ?? 'Active public company',
        dataNote: profile.dataNote ?? null,
    }
}

// Resolve the curated profile for one ticker, falling back to a clearly labeled placeholder when absent.
export async function buildStockInfo(stockCode: string): Promise<StockInfo> {
    const normalizedStockCode = normalizeStockCode(stockCode)

    validateStockCode(normalizedStockCode)

    const profile = STOCK_PROFILES[normalizedStockCode]

    return profile ? normalizeProfile(normalizedStockCode, profile) : buildFallbackProfile(normalizedStockCode)
}

// Format one stock profile into a compact CLI block that adds simulation context beyond price data.
export function formatStockInfo(stockInfo: StockInfo): string {
    return [
        `${stockInfo.stockCode} info:`,
        `  company: ${stockInfo.companyName}`,
        `  segment: ${stockInfo.segment}`,
        `  listing_status: ${stockInfo.listingStatus}`,
        `  summary: ${stockInfo.summary}`,
        `  data_note: ${stockInfo.dataNote ?? '-'}`,
    ].join('\n')
}

// Build the CLI-friendly stock-profile block for one ticker.
export async function showStockInfo(stockCode: string): Promise<string> {
    return formatStockInfo(await buildStockInfo(stockCode))
}

