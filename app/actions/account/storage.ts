export const ACCOUNT_STORAGE_KEY = 'stocksimulate2026.account'

export interface AccountPosition {
    quantity: number
    cost_per_share: number
    purchase_date: string
}

export interface AccountState {
    cash: number
    positions: Record<string, AccountPosition[]>
}

export interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

// Build the default account object that is stored for a fresh simulation.
export function createDefaultAccountState(): AccountState {
    return {
        cash: 0,
        positions: {},
    }
}

// Check whether a value is a plain object before reading account fields from it.
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Validate a single stored position lot before keeping it in the account state.
function isAccountPosition(value: unknown): value is AccountPosition {
    if (!isPlainObject(value)) {
        return false
    }

    return (
        typeof value.quantity === 'number' &&
        Number.isFinite(value.quantity) &&
        typeof value.cost_per_share === 'number' &&
        Number.isFinite(value.cost_per_share) &&
        typeof value.purchase_date === 'string' &&
        value.purchase_date.length > 0
    )
}

// Normalize unknown JSON into the app's account shape and drop invalid lots.
export function normalizeAccountState(value: unknown): AccountState {
    if (!isPlainObject(value)) {
        return createDefaultAccountState()
    }

    const cash = typeof value.cash === 'number' && Number.isFinite(value.cash) ? value.cash : 0
    const positionsSource = isPlainObject(value.positions) ? value.positions : {}
    const positions: Record<string, AccountPosition[]> = {}

    for (const [stockCode, stockPositions] of Object.entries(positionsSource)) {
        if (!Array.isArray(stockPositions)) {
            continue
        }

        const validPositions = stockPositions.filter(isAccountPosition)

        if (validPositions.length > 0) {
            positions[stockCode] = validPositions
        }
    }

    return { cash, positions }
}

// Read the current account from storage and fall back to a safe default on bad data.
export function readAccountStorage(storage: StorageLike): AccountState {
    const rawAccount = storage.getItem(ACCOUNT_STORAGE_KEY)

    if (!rawAccount) {
        return createDefaultAccountState()
    }

    try {
        return normalizeAccountState(JSON.parse(rawAccount))
    } catch {
        return createDefaultAccountState()
    }
}

// Reset the persisted account object and replace it with a fresh default state.
export function initializeAccountStorage(storage: StorageLike): AccountState {
    storage.removeItem(ACCOUNT_STORAGE_KEY)

    const defaultAccountState = createDefaultAccountState()

    storage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(defaultAccountState))

    return defaultAccountState
}
