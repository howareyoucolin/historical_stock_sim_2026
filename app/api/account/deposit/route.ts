import { NextResponse } from 'next/server'

import { applyActiveSessionFromPointer } from '../../../actions/session-management'

import { DEFAULT_USER_SESSION_RELATIVE_PATH } from '../../../actions/account/model'
import { depositIntoDefaultUserAccountSession } from '../../../actions/account/deposit'
import { buildDefaultUserAccountSessionView } from '../../../actions/account/show'
import { recordViewValueSnapshot } from '../../../actions/account/values-log'

export const runtime = 'nodejs'

interface DepositRequestBody {
    amount?: number
}

// Add cash to the shared account and return the refreshed holdings view.
export async function POST(request: Request): Promise<Response> {
    // Operate on the session the UI has switched to (persisted pointer).
    await applyActiveSessionFromPointer()

    let body: DepositRequestBody

    try {
        body = (await request.json()) as DepositRequestBody
    } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
    }

    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
        return NextResponse.json({ error: 'Deposit amount must be a positive number.' }, { status: 400 })
    }

    try {
        const account = await depositIntoDefaultUserAccountSession(body.amount)
        const view = await buildDefaultUserAccountSessionView(account)
        await recordViewValueSnapshot(view)

        return NextResponse.json({
            view,
            sessionFile: DEFAULT_USER_SESSION_RELATIVE_PATH,
            message: `Deposited ${body.amount.toFixed(2)} into cash.`,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        return NextResponse.json({ error: message }, { status: 400 })
    }
}
