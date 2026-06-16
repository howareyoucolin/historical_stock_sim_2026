import { NextResponse } from 'next/server'

import { DEFAULT_USER_SESSION_RELATIVE_PATH } from '../../../actions/account/model'
import { advanceSimulationDate, getTradingCalendarDates } from '../../../actions/date/advance'
import { buildDefaultUserAccountSessionView } from '../../../actions/account/show'

export const runtime = 'nodejs'

interface DateRequestBody {
    action?: string
    date?: string
}

// Return the trading calendar so the UI can offer only real market days for fast-forwarding.
export async function GET(): Promise<Response> {
    const tradingDates = await getTradingCalendarDates()

    return NextResponse.json({ tradingDates })
}

// Advance the simulation date to the next trading day or forward to a chosen target date.
export async function POST(request: Request): Promise<Response> {
    let body: DateRequestBody

    try {
        body = (await request.json()) as DateRequestBody
    } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
    }

    let target: string | null

    if (body.action === 'next') {
        target = null
    } else if (body.action === 'set') {
        if (typeof body.date !== 'string' || body.date.trim() === '') {
            return NextResponse.json({ error: 'A target date is required to fast forward.' }, { status: 400 })
        }

        target = body.date
    } else {
        return NextResponse.json({ error: 'Action must be "next" or "set".' }, { status: 400 })
    }

    try {
        const result = await advanceSimulationDate(target, {})
        const view = await buildDefaultUserAccountSessionView(result.account)
        const dividendNote = result.totalDividends > 0 ? ` Collected ${result.totalDividends.toFixed(2)} in dividends.` : ''

        return NextResponse.json({
            view,
            sessionFile: DEFAULT_USER_SESSION_RELATIVE_PATH,
            message: `Advanced to ${result.account.date}.${dividendNote}`,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        return NextResponse.json({ error: message }, { status: 400 })
    }
}
