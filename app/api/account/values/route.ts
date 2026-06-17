import { NextResponse } from 'next/server'

import { readDailyValues } from '../../../actions/account/values-log'

export const runtime = 'nodejs'
// The value log changes at runtime, so this route must run per-request instead of being statically
// prerendered at build time (it has no POST handler to make it dynamic on its own).
export const dynamic = 'force-dynamic'

// Return the recorded daily total-value series (cash + holdings) for the summary graph.
export async function GET(): Promise<Response> {
    const snapshots = await readDailyValues()

    return NextResponse.json({ snapshots })
}
