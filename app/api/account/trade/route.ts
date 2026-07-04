import { NextResponse } from 'next/server'

import { applyActiveSessionFromPointer } from '../../../actions/session-management'

import { DEFAULT_USER_SESSION_RELATIVE_PATH } from '../../../actions/account/model'
import { buyStockInDefaultUserAccountSession } from '../../../actions/account/buy'
import { sellStockInDefaultUserAccountSession } from '../../../actions/account/sell'
import { buildDefaultUserAccountSessionView } from '../../../actions/account/show'
import { recordViewValueSnapshot } from '../../../actions/account/values-log'

export const runtime = 'nodejs'

interface TradeRequestBody {
    action?: string
    stockCode?: string
    quantity?: number
}

// Execute a buy or sell against the shared account and return the refreshed holdings view.
export async function POST(request: Request): Promise<Response> {
    // Operate on the session the UI has switched to (persisted pointer).
    await applyActiveSessionFromPointer()

    let body: TradeRequestBody

    try {
        body = (await request.json()) as TradeRequestBody
    } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
    }

    const { action, stockCode, quantity } = body

    if (action !== 'buy' && action !== 'sell') {
        return NextResponse.json({ error: 'Action must be "buy" or "sell".' }, { status: 400 })
    }

    if (typeof stockCode !== 'string' || stockCode.trim() === '') {
        return NextResponse.json({ error: 'A stock code is required.' }, { status: 400 })
    }

    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
        return NextResponse.json({ error: 'Quantity must be a positive integer.' }, { status: 400 })
    }

    try {
        const result =
            action === 'buy'
                ? await buyStockInDefaultUserAccountSession(stockCode, quantity)
                : await sellStockInDefaultUserAccountSession(stockCode, quantity)
        const view = await buildDefaultUserAccountSessionView(result.account)
        await recordViewValueSnapshot(view)
        const verb = action === 'buy' ? 'Bought' : 'Sold'

        return NextResponse.json({
            view,
            sessionFile: DEFAULT_USER_SESSION_RELATIVE_PATH,
            message: `${verb} ${result.quantity} ${result.stockCode}.`,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        return NextResponse.json({ error: message }, { status: 400 })
    }
}
