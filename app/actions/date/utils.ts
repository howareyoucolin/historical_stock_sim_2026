const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Validate a simulation date string and return the normalized ISO date value.
export function normalizeSimulationDate(dateString: string): string {
    if (!ISO_DATE_PATTERN.test(dateString)) {
        throw new Error('Date must be a valid YYYY-MM-DD value.')
    }

    const parsedDate = new Date(`${dateString}T00:00:00Z`)

    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateString) {
        throw new Error('Date must be a valid YYYY-MM-DD value.')
    }

    return dateString
}

// Add a number of UTC calendar days to a normalized simulation date string.
export function addDaysToSimulationDate(dateString: string, dayCount: number): string {
    const normalizedDate = normalizeSimulationDate(dateString)
    const parsedDate = new Date(`${normalizedDate}T00:00:00Z`)

    parsedDate.setUTCDate(parsedDate.getUTCDate() + dayCount)

    return parsedDate.toISOString().slice(0, 10)
}

// Classify a holding period as long-term when the shares were held strictly more than one year
// (sold after the one-year anniversary of purchase), mirroring the standard capital-gains rule.
// Both inputs are normalized YYYY-MM-DD strings, so chronological comparison is plain string order.
export function classifyHoldingTerm(purchaseDate: string, sellDate: string): 'SHORT' | 'LONG' {
    const purchase = new Date(`${normalizeSimulationDate(purchaseDate)}T00:00:00Z`)
    const oneYearAnniversary = new Date(
        Date.UTC(purchase.getUTCFullYear() + 1, purchase.getUTCMonth(), purchase.getUTCDate())
    )
    const anniversaryDate = oneYearAnniversary.toISOString().slice(0, 10)

    return normalizeSimulationDate(sellDate) > anniversaryDate ? 'LONG' : 'SHORT'
}

// Find the earliest trading date strictly after the given date, or null when none exists.
// ISO YYYY-MM-DD strings sort chronologically, so plain string comparison is safe here.
export function findNextTradingDate(currentDate: string, tradingDates: string[]): string | null {
    let nextTradingDate: string | null = null

    for (const tradingDate of tradingDates) {
        if (tradingDate > currentDate && (nextTradingDate === null || tradingDate < nextTradingDate)) {
            nextTradingDate = tradingDate
        }
    }

    return nextTradingDate
}
