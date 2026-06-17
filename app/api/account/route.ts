import { NextResponse } from 'next/server'

import {
    DEFAULT_USER_SESSION_RELATIVE_PATH,
} from '../../actions/account/model'
import { initializeDefaultUserAccountSession } from '../../actions/account/init'
import { buildDefaultUserAccountSessionView, fetchDefaultUserAccountSessionView } from '../../actions/account/show'
import { recordViewValueSnapshot } from '../../actions/account/values-log'

export const runtime = 'nodejs'

// Return the shared account snapshot that backs both the browser UI and the CLI.
export async function GET(): Promise<Response> {
    const view = await fetchDefaultUserAccountSessionView()

    return NextResponse.json({
        view,
        sessionFile: DEFAULT_USER_SESSION_RELATIVE_PATH,
    })
}

// Reset the shared account snapshot to the default state stored in the user session file.
export async function POST(): Promise<Response> {
    const account = await initializeDefaultUserAccountSession()
    const view = await buildDefaultUserAccountSessionView(account)

    // Seed the freshly cleared value log so the graph has a starting anchor point after a reset.
    await recordViewValueSnapshot(view)

    return NextResponse.json({
        view,
        sessionFile: DEFAULT_USER_SESSION_RELATIVE_PATH,
    })
}
