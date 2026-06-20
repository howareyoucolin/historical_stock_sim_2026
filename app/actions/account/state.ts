export interface AccountPosition {
    quantity: number
    cost_per_share: number
    purchase_date: string
}

export interface AccountState {
    date: string
    cash: number
    positions: Record<string, AccountPosition[]>
    // Interest accrued on parked cash since the last monthly payout. Optional and only present once a
    // non-zero amount has built up, so a fresh or fully-deployed account keeps its minimal shape.
    accruedInterest?: number
}

// The persisted account data file (account.json): balances and holdings only.
export interface AccountData {
    cash: number
    positions: Record<string, AccountPosition[]>
    // Persisted only when non-zero so accrued interest survives across single-day advances.
    accruedInterest?: number
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
// accruedInterest is carried only when non-zero so accounts without parked-cash interest keep the
// minimal { date, cash, positions } shape that callers (and tests) expect.
export function normalizeAccountState(account: Partial<AccountState>): AccountState {
    const normalized: AccountState = {
        date: account.date ?? DEFAULT_ACCOUNT_DATE,
        cash: account.cash ?? 0,
        positions: account.positions ?? {},
    }

    if (account.accruedInterest) {
        normalized.accruedInterest = account.accruedInterest
    }

    return normalized
}
