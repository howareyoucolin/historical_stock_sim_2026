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
