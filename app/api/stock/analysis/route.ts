import { NextResponse } from 'next/server'

import { buildStockAnalysis } from '../../../actions/stock/analysis'
import { buildStockInfo } from '../../../actions/stock/info'

export const runtime = 'nodejs'
// The analysis depends on the current simulation date stored in the account session, so this route
// must run per-request rather than being statically prerendered at build time.
export const dynamic = 'force-dynamic'

// Return a single stock's analysis snapshot (price series plus figures) as of the simulation date.
export async function GET(request: Request): Promise<Response> {
    const code = new URL(request.url).searchParams.get('code')

    if (!code) {
        return NextResponse.json({ error: 'A stock code is required.' }, { status: 400 })
    }

    try {
        const analysis = await buildStockAnalysis(code)

        if (analysis === null) {
            return NextResponse.json({ error: `No price data for ${code.trim().toUpperCase()} on or before the simulation date.` }, { status: 404 })
        }

        const info = await buildStockInfo(code)

        return NextResponse.json({ analysis, info })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        return NextResponse.json({ error: message }, { status: 400 })
    }
}
