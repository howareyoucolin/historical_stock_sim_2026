import { NextResponse } from 'next/server'

import { readDailyValues, trimLeadingZeroValues } from '../../../actions/account/values-log'

export const runtime = 'nodejs'
// The value log changes at runtime, so this route must run per-request instead of being statically
// prerendered at build time (it has no POST handler to make it dynamic on its own).
export const dynamic = 'force-dynamic'

// Return the recorded daily total-value series (cash + holdings) for the summary graph, trimming the
// leading unfunded (zero-value) period so the graph starts when the portfolio first holds value.
export async function GET(): Promise<Response> {
    const snapshots = trimLeadingZeroValues(await readDailyValues())

    return NextResponse.json({ snapshots })
}
