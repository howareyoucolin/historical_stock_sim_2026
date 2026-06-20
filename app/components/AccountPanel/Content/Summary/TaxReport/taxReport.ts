// Per-year realized-gain and estimated-tax computation, derived from the raw history log lines.
// Realized gains are reconstructed from SELL events: a sell records its sell price, quantity, the
// acquisition date of the lot, and whether the holding period was LONG or SHORT. Pairing each sell
// with the BUY made on that acquisition date yields the cost basis, and therefore the realized gain.
// Dividends come straight from DIVIDEND events; interest from any INTEREST events (none today, but
// the column is kept so the table is complete and future-proof).

// Estimated tax-rate assumptions. These are deliberately simple, planning-grade defaults — not tax
// advice — and are surfaced in the UI so the estimate is transparent. Adjust here to re-rate.
export const TAX_RATES = {
    longTerm: 0.15, // long-term capital gains
    shortTerm: 0.24, // short-term gains, taxed as ordinary income
    dividend: 0.15, // qualified dividends
    interest: 0.24, // interest, taxed as ordinary income
} as const

export interface YearTaxRow {
    year: string
    longTermGain: number
    shortTermGain: number
    dividendGain: number
    interestGain: number
    estimatedTax: number
}

export interface TaxReport {
    years: YearTaxRow[]
    total: YearTaxRow
}

interface ParsedEvent {
    type: string
    fields: Record<string, string>
}

// Split one history line into its event type and key=value fields, ignoring the trailing quoted note.
function parseEvent(line: string): ParsedEvent | null {
    const parts = line.split(' ')

    if (parts.length < 2) {
        return null
    }

    const fields: Record<string, string> = {}

    for (const token of parts.slice(2)) {
        if (token.startsWith('note=')) {
            break
        }

        const separator = token.indexOf('=')

        if (separator !== -1) {
            fields[token.slice(0, separator)] = token.slice(separator + 1)
        }
    }

    return { type: parts[1], fields }
}

// Build a per-(stock, date) average buy price so each sell lot can be valued against its cost basis.
// Averaging tolerates the rare case of more than one buy of the same stock on the same day.
function buildBuyPriceIndex(events: ParsedEvent[]): Map<string, number> {
    const quantityByKey = new Map<string, number>()
    const costByKey = new Map<string, number>()

    for (const { type, fields } of events) {
        if (type !== 'BUY') {
            continue
        }

        const key = `${fields.stock}@${fields.sim}`
        const quantity = Number.parseFloat(fields.qty)
        const price = Number.parseFloat(fields.price)

        if (Number.isNaN(quantity) || Number.isNaN(price)) {
            continue
        }

        quantityByKey.set(key, (quantityByKey.get(key) ?? 0) + quantity)
        costByKey.set(key, (costByKey.get(key) ?? 0) + quantity * price)
    }

    const averageByKey = new Map<string, number>()

    Array.from(quantityByKey.entries()).forEach(([key, quantity]) => {
        if (quantity > 0) {
            averageByKey.set(key, (costByKey.get(key) ?? 0) / quantity)
        }
    })

    return averageByKey
}

// Create a zeroed row for a given year (or the total label).
function emptyRow(year: string): YearTaxRow {
    return { year, longTermGain: 0, shortTermGain: 0, dividendGain: 0, interestGain: 0, estimatedTax: 0 }
}

// Estimate tax for a year. Each positive category is taxed at its assumed rate; categories that net to
// a loss contribute no tax (losses are not turned into a credit here), keeping the estimate conservative.
function estimateTax(row: YearTaxRow): number {
    return (
        Math.max(0, row.longTermGain) * TAX_RATES.longTerm +
        Math.max(0, row.shortTermGain) * TAX_RATES.shortTerm +
        Math.max(0, row.dividendGain) * TAX_RATES.dividend +
        Math.max(0, row.interestGain) * TAX_RATES.interest
    )
}

// Build the per-year realized-gain and estimated-tax report from raw history log lines.
export function buildTaxReport(entries: string[]): TaxReport {
    const events = entries.map(parseEvent).filter((event): event is ParsedEvent => event !== null)
    const buyPriceIndex = buildBuyPriceIndex(events)
    const rowsByYear = new Map<string, YearTaxRow>()

    // Fetch (or lazily create) the accumulator row for a simulated year.
    const rowFor = (sim: string): YearTaxRow => {
        const year = (sim ?? '').slice(0, 4) || 'Unknown'
        let row = rowsByYear.get(year)

        if (!row) {
            row = emptyRow(year)
            rowsByYear.set(year, row)
        }

        return row
    }

    for (const { type, fields } of events) {
        if (type === 'SELL') {
            const quantity = Number.parseFloat(fields.qty)
            const sellPrice = Number.parseFloat(fields.price)
            const buyPrice = buyPriceIndex.get(`${fields.stock}@${fields.acquired}`)

            // Without a matching buy the cost basis is unknown, so the gain cannot be computed.
            if (Number.isNaN(quantity) || Number.isNaN(sellPrice) || buyPrice === undefined) {
                continue
            }

            const gain = (sellPrice - buyPrice) * quantity
            const row = rowFor(fields.sim)

            if (fields.term === 'LONG') {
                row.longTermGain += gain
            } else {
                row.shortTermGain += gain
            }
        } else if (type === 'DIVIDEND') {
            const amount = Number.parseFloat(fields.cash)

            if (!Number.isNaN(amount)) {
                rowFor(fields.sim).dividendGain += amount
            }
        } else if (type === 'INTEREST') {
            const amount = Number.parseFloat(fields.cash)

            if (!Number.isNaN(amount)) {
                rowFor(fields.sim).interestGain += amount
            }
        }
    }

    const years = Array.from(rowsByYear.values()).sort((left, right) => left.year.localeCompare(right.year))
    const total = emptyRow('Total')

    for (const row of years) {
        row.estimatedTax = estimateTax(row)
        total.longTermGain += row.longTermGain
        total.shortTermGain += row.shortTermGain
        total.dividendGain += row.dividendGain
        total.interestGain += row.interestGain
        total.estimatedTax += row.estimatedTax
    }

    return { years, total }
}
