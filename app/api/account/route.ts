import { NextResponse } from 'next/server'

import {
    DEFAULT_USER_SESSION_RELATIVE_PATH,
    readDefaultUserAccountSession,
} from '../../actions/account/model'
import { initializeDefaultUserAccountSession } from '../../actions/account/init'

export const runtime = 'nodejs'

// Return the shared account snapshot that backs both the browser UI and the CLI.
export async function GET(): Promise<Response> {
    const account = await readDefaultUserAccountSession()

    return NextResponse.json({
        account,
        sessionFile: DEFAULT_USER_SESSION_RELATIVE_PATH,
    })
}

// Reset the shared account snapshot to the default state stored in the user session file.
export async function POST(): Promise<Response> {
    const account = await initializeDefaultUserAccountSession()

    return NextResponse.json({
        account,
        sessionFile: DEFAULT_USER_SESSION_RELATIVE_PATH,
    })
}
