import fs from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_SESSION_NAME, setActiveSession, USER_SESSIONS_DIRECTORY_NAME } from './session'
import { readDefaultUserAccountMeta, writeDefaultUserAccountSession, createDefaultAccountState } from './account/model'

// Where the active session name is persisted so the browser UI (whose API requests are stateless)
// resolves the same session across requests. The CLI uses --session instead of this pointer.
const ACTIVE_SESSION_POINTER_FILE = 'active-session.json'

// Session names must be safe folder names: no path separators, dots, or spaces. This also keeps them
// from colliding with the pointer file or any legacy flat "<name>.account.json" form.
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export interface SessionManagementDependencies {
    cwd?: () => string
}

export interface SessionSummary {
    name: string
    active: boolean
    date: string | null
    updatedAt: string | null
}

// Validate a requested session name, throwing a clear error when it is unusable as a folder name.
export function validateSessionName(name: string): string {
    const trimmed = name.trim()

    if (!SESSION_NAME_PATTERN.test(trimmed)) {
        throw new Error('Session name must be 1-64 chars: letters, digits, dashes, or underscores (no spaces, dots, or slashes).')
    }

    return trimmed
}

function sessionsDirectory(cwd: () => string): string {
    return path.join(cwd(), USER_SESSIONS_DIRECTORY_NAME)
}

// Read the persisted active session name, defaulting to the default session when unset/unreadable.
export async function readActiveSessionName({ cwd = process.cwd }: SessionManagementDependencies = {}): Promise<string> {
    try {
        const raw = await fs.readFile(path.join(sessionsDirectory(cwd), ACTIVE_SESSION_POINTER_FILE), 'utf8')
        const parsed = JSON.parse(raw) as { name?: string }

        return parsed.name && SESSION_NAME_PATTERN.test(parsed.name) ? parsed.name : DEFAULT_SESSION_NAME
    } catch {
        return DEFAULT_SESSION_NAME
    }
}

// Persist the active session name for the web UI.
export async function writeActiveSessionName(name: string, { cwd = process.cwd }: SessionManagementDependencies = {}): Promise<void> {
    const validated = validateSessionName(name)

    await fs.mkdir(sessionsDirectory(cwd), { recursive: true })
    await fs.writeFile(path.join(sessionsDirectory(cwd), ACTIVE_SESSION_POINTER_FILE), `${JSON.stringify({ name: validated }, null, 2)}\n`, 'utf8')
}

// Apply the persisted active session to the process-global selection (for the stateless web path).
// Maps the default session back to null so getActiveSession()/folder resolution stay consistent.
export async function applyActiveSessionFromPointer(dependencies: SessionManagementDependencies = {}): Promise<string> {
    const name = await readActiveSessionName(dependencies)
    setActiveSession(name === DEFAULT_SESSION_NAME ? null : name)

    return name
}

// List every session (each user-sessions/<name>/ folder), annotated with its sim date + last-updated
// timestamp and whether it is the active one. The default session is always present in the list.
export async function listSessions(dependencies: SessionManagementDependencies = {}): Promise<SessionSummary[]> {
    const { cwd = process.cwd } = dependencies
    const active = await readActiveSessionName(dependencies)

    let entries: import('node:fs').Dirent[] = []
    try {
        entries = await fs.readdir(sessionsDirectory(cwd), { withFileTypes: true })
    } catch {
        entries = []
    }

    const names = new Set<string>([DEFAULT_SESSION_NAME])
    for (const entry of entries) {
        if (entry.isDirectory() && SESSION_NAME_PATTERN.test(entry.name)) {
            names.add(entry.name)
        }
    }

    const summaries: SessionSummary[] = []
    for (const name of Array.from(names).sort()) {
        // Read each session's meta via the process-global selection, restoring it afterward.
        setActiveSession(name === DEFAULT_SESSION_NAME ? null : name)
        const meta = await readDefaultUserAccountMeta({ cwd })
        summaries.push({ name, active: name === active, date: meta?.date ?? null, updatedAt: meta?.updated_at ?? null })
    }
    setActiveSession(active === DEFAULT_SESSION_NAME ? null : active)

    return summaries
}

// Create a new session by name (fresh default account in its own folder) and make it active. Fails if
// a session with that name already exists.
export async function createSession(name: string, dependencies: SessionManagementDependencies = {}): Promise<SessionSummary> {
    const { cwd = process.cwd } = dependencies
    const validated = validateSessionName(name)

    try {
        await fs.access(path.join(sessionsDirectory(cwd), validated))
        throw new Error(`Session "${validated}" already exists.`)
    } catch (error) {
        if (!(error as NodeJS.ErrnoException).code) {
            throw error // the "already exists" error above (no fs errno)
        }
    }

    setActiveSession(validated)
    const account = await writeDefaultUserAccountSession(createDefaultAccountState(), { cwd })
    await writeActiveSessionName(validated, { cwd })

    return { name: validated, active: true, date: account.date, updatedAt: null }
}

// Switch the active session to an existing one (or the default). Persists the pointer for the web UI.
export async function switchSession(name: string, dependencies: SessionManagementDependencies = {}): Promise<string> {
    const validated = validateSessionName(name)
    await writeActiveSessionName(validated, dependencies)
    setActiveSession(validated === DEFAULT_SESSION_NAME ? null : validated)

    return validated
}

// Delete a session's folder (and any legacy flat files). Deleting the active session falls back to the
// default session. The default session cannot be deleted (it is the always-present home session).
export async function deleteSession(name: string, dependencies: SessionManagementDependencies = {}): Promise<void> {
    const { cwd = process.cwd } = dependencies
    const validated = validateSessionName(name)

    if (validated === DEFAULT_SESSION_NAME) {
        throw new Error('The default session cannot be deleted.')
    }

    const dir = sessionsDirectory(cwd)
    await Promise.all([
        fs.rm(path.join(dir, validated), { recursive: true, force: true }),
        fs.rm(path.join(dir, `${validated}.account.json`), { force: true }),
        fs.rm(path.join(dir, `${validated}.meta.json`), { force: true }),
        fs.rm(path.join(dir, `${validated}.history.log`), { force: true }),
        fs.rm(path.join(dir, `${validated}.values.log`), { force: true }),
        fs.rm(path.join(dir, `${validated}.report.json`), { force: true }),
        fs.rm(path.join(dir, `${validated}.json`), { force: true }),
    ])

    if ((await readActiveSessionName(dependencies)) === validated) {
        await switchSession(DEFAULT_SESSION_NAME, dependencies)
    }
}
