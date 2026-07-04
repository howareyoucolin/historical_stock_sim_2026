import { NextResponse } from 'next/server'

import { createSession, deleteSession, listSessions, switchSession } from '../../actions/session-management'

export const runtime = 'nodejs'

// List all sessions (each user-sessions/<name>/ folder) with the active one flagged.
export async function GET(): Promise<Response> {
    const sessions = await listSessions()

    return NextResponse.json({ sessions })
}

interface SessionRequestBody {
    action?: 'create' | 'switch' | 'delete'
    name?: string
}

// Create / switch to / delete a session, then return the refreshed session list.
export async function POST(request: Request): Promise<Response> {
    let body: SessionRequestBody

    try {
        body = (await request.json()) as SessionRequestBody
    } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
    }

    if (!body.name || typeof body.name !== 'string') {
        return NextResponse.json({ error: 'A session name is required.' }, { status: 400 })
    }

    try {
        if (body.action === 'create') {
            await createSession(body.name)
        } else if (body.action === 'switch') {
            await switchSession(body.name)
        } else if (body.action === 'delete') {
            await deleteSession(body.name)
        } else {
            return NextResponse.json({ error: 'action must be one of: create, switch, delete.' }, { status: 400 })
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        return NextResponse.json({ error: message }, { status: 400 })
    }

    const sessions = await listSessions()

    return NextResponse.json({ sessions, active: sessions.find((session) => session.active)?.name ?? 'default' })
}
