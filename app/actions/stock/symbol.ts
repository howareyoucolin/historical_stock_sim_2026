// Stock-symbol helpers shared across the trading actions and CLI. Kept in their own tiny module so
// they don't depend on any data-acquisition code.

// Normalize a stock symbol to its canonical form (trimmed, upper-cased).
export function normalizeStockCode(stockCode: string): string {
    return stockCode.trim().toUpperCase()
}

// Validate that a stock symbol is safe for use in requests and lookups.
export function validateStockCode(stockCode: string): void {
    if (!/^[A-Z0-9.-]+$/.test(stockCode)) {
        throw new Error('Stock code may only contain letters, numbers, dots, and dashes.')
    }
}
