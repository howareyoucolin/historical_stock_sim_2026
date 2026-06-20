import { addDaysToSimulationDate } from '../date/utils'

// Interest paid on uninvested "parking" cash, modeled on SPAXX (Fidelity Government Money Market
// Fund). One representative annual yield per calendar year — approximate, fed-funds-driven figures,
// kept here as a single editable table. Interest accrues daily on the cash balance and is paid out
// on the first trading day of each month (see the date-advance action), where it then compounds.
export const SPAXX_ANNUAL_RATES: Record<number, number> = {
    2016: 0.0005,
    2017: 0.005,
    2018: 0.015,
    2019: 0.02,
    2020: 0.0045,
    2021: 0.0001,
    2022: 0.013,
    2023: 0.048,
    2024: 0.05,
    2025: 0.04,
    2026: 0.035,
}

// Convert an annual rate into a daily accrual rate with a simple fixed-day-count convention.
export const DAYS_PER_YEAR = 365

const RATE_YEARS = Object.keys(SPAXX_ANNUAL_RATES)
    .map(Number)
    .sort((left, right) => left - right)
const FIRST_RATE_YEAR = RATE_YEARS[0]
const LAST_RATE_YEAR = RATE_YEARS[RATE_YEARS.length - 1]

// Look up the annual interest rate for a calendar year, clamping to the nearest year in the table
// so dates outside the modeled range still earn a sensible rate instead of zero.
export function annualRateForYear(year: number): number {
    const clampedYear = Math.min(LAST_RATE_YEAR, Math.max(FIRST_RATE_YEAR, year))

    return SPAXX_ANNUAL_RATES[clampedYear] ?? 0
}

// Accrue interest on a constant balance across the calendar days in (fromDate, toDate], so weekends
// and holidays between two trading days still earn. Each day is rated by its own year, so a gap that
// spans a year boundary is split correctly. Dates are normalized YYYY-MM-DD strings; fromDate is
// exclusive (already accrued through) and toDate inclusive. Returns 0 for a non-positive balance.
export function accrueInterestOverGap(balance: number, fromDate: string, toDate: string): number {
    if (balance <= 0 || toDate <= fromDate) {
        return 0
    }

    let total = 0
    let cursor = addDaysToSimulationDate(fromDate, 1)

    while (cursor <= toDate) {
        const year = Number(cursor.slice(0, 4))
        total += balance * (annualRateForYear(year) / DAYS_PER_YEAR)
        cursor = addDaysToSimulationDate(cursor, 1)
    }

    return total
}
