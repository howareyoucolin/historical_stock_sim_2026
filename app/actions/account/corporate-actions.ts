import { normalizeStockCode } from '../stock/symbol'
import { fetchCorporateActions } from '../stock/market-data-client'

export type CorporateActionType = 'cash_buyout' | 'stock_swap' | 'equity_wipeout' | 'otc_continuation'

interface CorporateActionBase {
    stockCode: string
    date: string
    type: CorporateActionType
    note?: string
}

export interface CashBuyoutCorporateAction extends CorporateActionBase {
    type: 'cash_buyout'
    cashPerShare: number
}

export interface StockSwapCorporateAction extends CorporateActionBase {
    type: 'stock_swap'
    acquirerStockCode: string
    shareRatio: number
    cashPerShare?: number
}

export interface EquityWipeoutCorporateAction extends CorporateActionBase {
    type: 'equity_wipeout'
}

export interface OtcContinuationCorporateAction extends CorporateActionBase {
    type: 'otc_continuation'
}

export type CorporateAction =
    | CashBuyoutCorporateAction
    | StockSwapCorporateAction
    | EquityWipeoutCorporateAction
    | OtcContinuationCorporateAction

export interface CorporateActionDependencies {
    // Fetches the raw corporate-action rows from the market-data API; injectable for tests.
    getCorporateActions?: () => Promise<unknown[]>
}

// Reject malformed corporate-action rows early so simulation code can assume a valid shape.
function parseCorporateAction(entry: unknown, index: number): CorporateAction {
    if (!entry || typeof entry !== 'object') {
        throw new Error(`Invalid corporate action at index ${index}.`)
    }

    const action = entry as Record<string, unknown>
    const stockCode = normalizeStockCode(String(action.stockCode ?? ''))
    const date = String(action.date ?? '')
    const type = String(action.type ?? '') as CorporateActionType
    const note = typeof action.note === 'string' && action.note.trim().length > 0 ? action.note.trim() : undefined

    if (!stockCode || !date || !type) {
        throw new Error(`Corporate action at index ${index} is missing stockCode, date, or type.`)
    }

    switch (type) {
        case 'cash_buyout': {
            const cashPerShare = Number(action.cashPerShare)

            if (!Number.isFinite(cashPerShare) || cashPerShare < 0) {
                throw new Error(`Cash buyout for ${stockCode} must include a non-negative cashPerShare.`)
            }

            return { stockCode, date, type, cashPerShare, note }
        }
        case 'stock_swap': {
            const acquirerStockCode = normalizeStockCode(String(action.acquirerStockCode ?? ''))
            const shareRatio = Number(action.shareRatio)
            const cashPerShare = action.cashPerShare === undefined ? undefined : Number(action.cashPerShare)

            if (!acquirerStockCode) {
                throw new Error(`Stock swap for ${stockCode} must include acquirerStockCode.`)
            }

            if (!Number.isFinite(shareRatio) || shareRatio <= 0) {
                throw new Error(`Stock swap for ${stockCode} must include a positive shareRatio.`)
            }

            if (cashPerShare !== undefined && (!Number.isFinite(cashPerShare) || cashPerShare < 0)) {
                throw new Error(`Stock swap for ${stockCode} has an invalid cashPerShare.`)
            }

            return { stockCode, date, type, acquirerStockCode, shareRatio, cashPerShare, note }
        }
        case 'equity_wipeout':
            return { stockCode, date, type, note }
        case 'otc_continuation':
            return { stockCode, date, type, note }
        default:
            throw new Error(`Unsupported corporate action type for ${stockCode}: ${String(action.type)}`)
    }
}

// Fetch the corporate-action model from the market-data API, validating each row into a typed action.
export async function readCorporateActions({
    getCorporateActions = fetchCorporateActions,
}: CorporateActionDependencies = {}): Promise<CorporateAction[]> {
    const actions = await getCorporateActions()

    return actions.map(parseCorporateAction)
}

// Keep only the corporate actions scheduled exactly on the simulation date being stepped onto.
export function selectCorporateActionsForDate(actions: CorporateAction[], date: string): CorporateAction[] {
    return actions.filter((action) => action.date === date)
}

