import fs from 'node:fs/promises'
import path from 'node:path'

import { normalizeStockCode } from '../stock/download-data'

export const CORPORATE_ACTIONS_RELATIVE_PATH = 'config/corporate-actions.json'

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

interface CorporateActionsPayload {
    actions?: unknown[]
}

export interface CorporateActionDependencies {
    cwd?: () => string
    readConfigFile?: (path: string, encoding: BufferEncoding) => Promise<string>
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

// Read the repo's corporate-action config, returning an empty list when no delisting model exists yet.
export async function readCorporateActions({
    cwd = process.cwd,
    readConfigFile = fs.readFile,
}: CorporateActionDependencies = {}): Promise<CorporateAction[]> {
    const configPath = path.join(cwd(), CORPORATE_ACTIONS_RELATIVE_PATH)

    try {
        const payload = JSON.parse(await readConfigFile(configPath, 'utf8')) as CorporateActionsPayload

        return (payload.actions ?? []).map(parseCorporateAction)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return []
        }

        if (error instanceof SyntaxError) {
            throw new Error(`Invalid corporate actions JSON: ${error.message}`)
        }

        throw error
    }
}

// Keep only the corporate actions scheduled exactly on the simulation date being stepped onto.
export function selectCorporateActionsForDate(actions: CorporateAction[], date: string): CorporateAction[] {
    return actions.filter((action) => action.date === date)
}

