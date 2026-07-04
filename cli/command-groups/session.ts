import {
    createSession,
    deleteSession,
    listSessions,
    readActiveSessionName,
    switchSession,
    type SessionSummary,
} from '../../app/actions/session-management'
import type { CommandResult } from '../command-types'

export interface SessionCommandDependencies {
    listSessions?: typeof listSessions
    createSession?: typeof createSession
    switchSession?: typeof switchSession
    deleteSession?: typeof deleteSession
    readActiveSessionName?: typeof readActiveSessionName
}

export const SESSION_HELP_LINES = [
    '  session list             List all sessions (each user-sessions/<name>/ folder)',
    '  session current          Show the currently active session',
    '  session new <name>       Create a new named session and make it active',
    '  session use <name>       Switch the active session to <name>',
    '  session delete <name>    Delete a session folder (cannot delete "default")',
]

// Render the session list as an aligned table marking the active one.
function formatSessionList(sessions: SessionSummary[]): string {
    return sessions
        .map((session) => `${session.active ? '* ' : '  '}${session.name}  (date: ${session.date ?? '-'}, updated: ${session.updatedAt ?? '-'})`)
        .join('\n')
}

// Wrap a thrown action error into the standard failed CommandResult for a labeled operation.
function failure(label: string, error: unknown): CommandResult {
    const message = error instanceof Error ? error.message : String(error)

    return { output: `${label}: ${message}`, shouldExit: false, exitCode: 1 }
}

// Build the `session` command handler for managing multiple user-session folders.
export function createSessionCommandHandler({
    listSessions: listSessionsFn = listSessions,
    createSession: createSessionFn = createSession,
    switchSession: switchSessionFn = switchSession,
    deleteSession: deleteSessionFn = deleteSession,
    readActiveSessionName: readActiveSessionNameFn = readActiveSessionName,
}: SessionCommandDependencies = {}) {
    return async function runSessionCommand(args: string[]): Promise<CommandResult> {
        const sub = args[0]
        const name = args[1]

        switch (sub) {
            case 'list':
                try {
                    const sessions = await listSessionsFn()
                    return { output: formatSessionList(sessions), data: { sessions }, shouldExit: false, exitCode: 0 }
                } catch (error) {
                    return failure('Session list failed', error)
                }
            case 'current':
                try {
                    const active = await readActiveSessionNameFn()
                    return { output: `Active session: ${active}`, data: { active }, shouldExit: false, exitCode: 0 }
                } catch (error) {
                    return failure('Session current failed', error)
                }
            case 'new':
                if (!name) {
                    return { output: 'Usage: session new <name>', shouldExit: false, exitCode: 1 }
                }
                try {
                    const created = await createSessionFn(name)
                    return { output: `Created session "${created.name}" and set it active.`, data: { session: created }, shouldExit: false, exitCode: 0 }
                } catch (error) {
                    return failure('Session new failed', error)
                }
            case 'use':
                if (!name) {
                    return { output: 'Usage: session use <name>', shouldExit: false, exitCode: 1 }
                }
                try {
                    const active = await switchSessionFn(name)
                    return { output: `Switched active session to "${active}".`, data: { active }, shouldExit: false, exitCode: 0 }
                } catch (error) {
                    return failure('Session use failed', error)
                }
            case 'delete':
                if (!name) {
                    return { output: 'Usage: session delete <name>', shouldExit: false, exitCode: 1 }
                }
                try {
                    await deleteSessionFn(name)
                    return { output: `Deleted session "${name}".`, data: { deleted: name }, shouldExit: false, exitCode: 0 }
                } catch (error) {
                    return failure('Session delete failed', error)
                }
            default:
                return { output: 'Usage: session <list|current|new <name>|use <name>|delete <name>>', shouldExit: false, exitCode: 1 }
        }
    }
}
