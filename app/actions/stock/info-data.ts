import { readFileSync } from 'node:fs'
import path from 'node:path'

export interface StockProfile {
    companyName: string
    segment: string
    summary: string
    listingStatus?: string
    dataNote?: string
}

const STOCK_PROFILES_CONFIG_RELATIVE_PATH = 'config/stock-profiles.json'

interface StockProfilesPayload {
    profiles?: Record<string, StockProfile>
}

// Load the curated stock-profile map from config once at startup; a missing or malformed file
// degrades to an empty map so the fallback profile path still works.
function loadStockProfiles(): Record<string, StockProfile> {
    try {
        const raw = readFileSync(path.join(process.cwd(), STOCK_PROFILES_CONFIG_RELATIVE_PATH), 'utf8')
        const parsed = JSON.parse(raw) as StockProfilesPayload

        return parsed.profiles ?? {}
    } catch {
        return {}
    }
}

export const STOCK_PROFILES = loadStockProfiles()
