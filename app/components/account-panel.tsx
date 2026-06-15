'use client'

import { useEffect, useState } from 'react'

import { createDefaultAccountState, type AccountState } from '../actions/account/storage'

interface AccountResponse {
    account: AccountState
    sessionFile: string
}

// Render the browser account controls and current shared account snapshot.
export function AccountPanel() {
    const [account, setAccount] = useState<AccountState>(createDefaultAccountState)
    const [sessionFile, setSessionFile] = useState('user-sessions/default.json')
    const [statusMessage, setStatusMessage] = useState('Loading the shared account session...')
    const [isSaving, setIsSaving] = useState(false)

    // Fetch the shared account snapshot from the server-backed user session file.
    useEffect(() => {
        void loadAccountSnapshot()
    }, [])

    // Load the current account object and session file path from the shared API.
    async function loadAccountSnapshot(): Promise<void> {
        const response = await fetch('/api/account', { cache: 'no-store' })
        const payload = (await response.json()) as AccountResponse

        setAccount(payload.account)
        setSessionFile(payload.sessionFile)
        setStatusMessage(`Loaded shared session from ${payload.sessionFile}.`)
    }

    // Reset the shared account session file to the default simulation shape.
    async function handleAccountInit(): Promise<void> {
        setIsSaving(true)

        try {
            const response = await fetch('/api/account', {
                method: 'POST',
            })
            const payload = (await response.json()) as AccountResponse

            setAccount(payload.account)
            setSessionFile(payload.sessionFile)
            setStatusMessage(`Reset shared session in ${payload.sessionFile}.`)
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <main className="page">
            <section className="card">
                <p className="eyebrow">StockSimulate2026</p>
                <h1>Account Init</h1>
                <p className="copy">
                    Reset the shared account object in <code>{sessionFile}</code> and replace it with a clean default.
                </p>
                <div className="actions">
                    <button className="primaryButton" type="button" onClick={() => void handleAccountInit()} disabled={isSaving}>
                        {isSaving ? 'Resetting...' : 'Account Init'}
                    </button>
                </div>
                <p className="status">{statusMessage}</p>
                <div className="storageMeta">
                    <span>Session file</span>
                    <code>{sessionFile}</code>
                </div>
                <pre className="jsonPreview">{JSON.stringify(account, null, 2)}</pre>
            </section>
        </main>
    )
}
