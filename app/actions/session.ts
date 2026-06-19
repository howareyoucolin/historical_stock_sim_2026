// The active session name selects which set of files under user-sessions/ the account actions read
// and write. It is process-global so the CLI can switch it per command via `--session=<name>`
// without threading the name through every action signature. `null` means the default session.
let activeSession: string | null = null

export const USER_SESSIONS_DIRECTORY_NAME = 'user-sessions'

// Set (or clear, with null) the active session. Blank names collapse to the default session.
export function setActiveSession(name: string | null): void {
    const trimmed = name?.trim()
    activeSession = trimmed ? trimmed : null
}

// Return the active session name, or null when the default session is in use.
export function getActiveSession(): string | null {
    return activeSession
}

// Account data file name (cash + positions) for the active session (default: account.json).
export function accountDataFileName(): string {
    return activeSession ? `${activeSession}.account.json` : 'account.json'
}

// Session metadata file name (sim date + updated_at) for the active session (default: meta.json).
export function accountMetaFileName(): string {
    return activeSession ? `${activeSession}.meta.json` : 'meta.json'
}

// Legacy pre-split single-file account name, kept only so older sessions migrate on first read.
export function legacyAccountSessionFileName(): string {
    return activeSession ? `${activeSession}.json` : 'default.json'
}

// History log file name for the active session (default: history.log).
export function historyLogFileName(): string {
    return activeSession ? `${activeSession}.history.log` : 'history.log'
}

// Daily-value log file name for the active session (default: values.log).
export function valuesLogFileName(): string {
    return activeSession ? `${activeSession}.values.log` : 'values.log'
}

// Repo-relative path of the active session's account data file, for user-facing messages.
export function activeAccountSessionRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${accountDataFileName()}`
}
