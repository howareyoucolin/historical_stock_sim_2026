import { NextResponse } from 'next/server'

import { readHistoryLogEntries } from '../../../actions/history/log'

export const runtime = 'nodejs'
// The history log changes at runtime, so this route must run per-request instead of being
// statically prerendered at build time (it has no POST handler to make it dynamic on its own).
export const dynamic = 'force-dynamic'

// Return the recorded account history (buys, sells, dividends, deposits) for the browser history tab.
export async function GET(): Promise<Response> {
    const entries = await readHistoryLogEntries()

    return NextResponse.json({ entries })
}
