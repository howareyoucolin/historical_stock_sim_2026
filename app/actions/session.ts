// The active session name selects which folder under user-sessions/ the account actions read and
// write. It is process-global so the CLI can switch it per command via `--session=<name>` without
// threading the name through every action signature. `null` means the default session ("default").
//
// Storage layout: every session lives in its OWN folder, user-sessions/<name>/, holding account.json,
// meta.json, history.log, values.log, and report.json. The default session is the "default" folder.
// Older FLAT layouts (bare files, or <name>.account.json, or a pre-split <name>.json) are migrated on
// first read by readDefaultUserAccountSession via the legacy* helpers below.
let activeSession: string | null = null

export const USER_SESSIONS_DIRECTORY_NAME = 'user-sessions'
export const DEFAULT_SESSION_NAME = 'default'

// Set (or clear, with null) the active session. Blank names collapse to the default session.
export function setActiveSession(name: string | null): void {
    const trimmed = name?.trim()
    activeSession = trimmed ? trimmed : null
}

// Return the active session name, or null when the default session is in use.
export function getActiveSession(): string | null {
    return activeSession
}

// The folder name for the active session under user-sessions/ (default session -> "default").
export function sessionFolderName(): string {
    return activeSession ?? DEFAULT_SESSION_NAME
}

// --- Current (folder) layout: paths are relative to user-sessions/ and include the session folder. ---

// Account data file (cash + positions) for the active session, e.g. "default/account.json".
export function accountDataFileName(): string {
    return `${sessionFolderName()}/account.json`
}

// Session metadata file (sim date + updated_at) for the active session, e.g. "default/meta.json".
export function accountMetaFileName(): string {
    return `${sessionFolderName()}/meta.json`
}

// History log file for the active session, e.g. "default/history.log".
export function historyLogFileName(): string {
    return `${sessionFolderName()}/history.log`
}

// Daily-value log file for the active session, e.g. "default/values.log".
export function valuesLogFileName(): string {
    return `${sessionFolderName()}/values.log`
}

// Built report file for the active session, e.g. "default/report.json".
export function reportFileName(): string {
    return `${sessionFolderName()}/report.json`
}

// --- Legacy (pre-folder) layouts, kept only so existing sessions migrate on first read. ---

// Legacy FLAT split data/meta files: bare (default) or "<name>.account.json" / "<name>.meta.json".
export function legacyFlatAccountDataFileName(): string {
    return activeSession ? `${activeSession}.account.json` : 'account.json'
}

export function legacyFlatAccountMetaFileName(): string {
    return activeSession ? `${activeSession}.meta.json` : 'meta.json'
}

// Legacy pre-split single-file account: "<name>.json" (named) or "default.json" (default).
export function legacyAccountSessionFileName(): string {
    return activeSession ? `${activeSession}.json` : 'default.json'
}

// --- Repo-relative paths, for user-facing messages. ---

// Repo-relative path of the active session's account data file.
export function activeAccountSessionRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${accountDataFileName()}`
}

// Repo-relative path of the active session's built report file.
export function activeReportRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${reportFileName()}`
}
