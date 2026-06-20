// Presentational formatting helpers shared by the holdings table, account header, and sidebar meta.

// Format a number with thousands separators and two decimals for monetary display.
export function money(value: number): string {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Format a signed monetary value so gains and losses read clearly in the table.
export function signedMoney(value: number): string {
    return `${value >= 0 ? '+' : '-'}${money(Math.abs(value))}`
}

// Format a signed percentage value for change columns.
export function signedPercent(value: number): string {
    return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`
}

// Format a plain percentage value (e.g. share of group).
export function percent(value: number): string {
    return `${value.toFixed(2)}%`
}

// Format a market cap given in USD millions with a magnitude suffix, e.g. 2311050 -> "$2.31T".
export function marketCap(millions: number | null | undefined): string {
    if (millions === null || millions === undefined) {
        return '—'
    }

    if (millions >= 1_000_000) {
        return `$${(millions / 1_000_000).toFixed(2)}T`
    }

    if (millions >= 1_000) {
        return `$${(millions / 1_000).toFixed(1)}B`
    }

    return `$${millions.toFixed(0)}M`
}

// Map a numeric change to a CSS tone class so positive and negative values are colored.
export function tone(value: number): string {
    if (value > 0) {
        return 'pos'
    }

    if (value < 0) {
        return 'neg'
    }

    return ''
}
