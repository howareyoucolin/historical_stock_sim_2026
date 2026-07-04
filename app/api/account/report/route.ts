import { NextResponse } from 'next/server'

import { applyActiveSessionFromPointer } from '../../../actions/session-management'

import { readSimulationReport } from '../../../actions/report/read'

export const runtime = 'nodejs'
// The saved report can appear after the app is already running, so always resolve it per request.
export const dynamic = 'force-dynamic'

// Return the saved simulation report JSON for the browser report tab, or null when no report exists yet.
export async function GET(): Promise<Response> {
    // Operate on the session the UI has switched to (persisted pointer).
    await applyActiveSessionFromPointer()

    const report = await readSimulationReport()

    return NextResponse.json({ report })
}
