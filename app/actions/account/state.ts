export interface AccountPosition {
    quantity: number
    cost_per_share: number
    purchase_date: string
}

export interface AccountState {
    date: string
    cash: number
    positions: Record<string, AccountPosition[]>
}

// The persisted account data file (account.json): balances and holdings only.
export interface AccountData {
    cash: number
    positions: Record<string, AccountPosition[]>
}

// The persisted session metadata file (meta.json): the simulated date plus a write timestamp that
// pollers compare to cheaply detect whether anything changed before doing a full fetch.
export interface AccountMeta {
    date: string
    updated_at: string
}

export const DEFAULT_ACCOUNT_DATE = '2016-01-04'

// Build a fresh default account object so callers never share mutable nested state.
export function createDefaultAccountState(): AccountState {
    return {
        date: DEFAULT_ACCOUNT_DATE,
        cash: 0,
        positions: {},
    }
}

// Fill in any missing account fields so older session JSON still loads with the current shape.
export function normalizeAccountState(account: Partial<AccountState>): AccountState {
    return {
        date: account.date ?? DEFAULT_ACCOUNT_DATE,
        cash: account.cash ?? 0,
        positions: account.positions ?? {},
    }
}
