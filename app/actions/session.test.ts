import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { accountDataFileName, accountMetaFileName, getActiveSession, historyLogFileName, setActiveSession, valuesLogFileName } from './session'
import { readDefaultUserAccountSession, writeDefaultUserAccountSession } from './account/model'

// Build a temporary repo root so session tests can write to isolated files.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate-session-'))
}

// Verify the file-name resolvers reflect the active session and fall back to the defaults.
function testSessionFileNames(): void {
    setActiveSession(null)
    assert.equal(accountDataFileName(), 'account.json')
    assert.equal(accountMetaFileName(), 'meta.json')
    assert.equal(historyLogFileName(), 'history.log')
    assert.equal(valuesLogFileName(), 'values.log')

    setActiveSession('alpha')
    assert.equal(getActiveSession(), 'alpha')
    assert.equal(accountDataFileName(), 'alpha.account.json')
    assert.equal(accountMetaFileName(), 'alpha.meta.json')
    assert.equal(historyLogFileName(), 'alpha.history.log')
    assert.equal(valuesLogFileName(), 'alpha.values.log')

    // Blank names collapse back to the default session.
    setActiveSession('   ')
    assert.equal(getActiveSession(), null)
}

// Verify a named session reads and writes its own account file, isolated from the default session.
async function testSessionIsolatesAccountFile(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    try {
        setActiveSession('alpha')
        await writeDefaultUserAccountSession({ date: '2020-02-14', cash: 4242, positions: {} }, { cwd: () => tempRepoRoot })

        // The named session's data file exists; the default session's does not.
        const alphaRaw = await fs.readFile(path.join(tempRepoRoot, 'user-sessions', 'alpha.account.json'), 'utf8')
        assert.match(alphaRaw, /4242/)
        await assert.rejects(fs.readFile(path.join(tempRepoRoot, 'user-sessions', 'account.json'), 'utf8'))

        const alphaAccount = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot })
        assert.equal(alphaAccount.cash, 4242)
    } finally {
        // Always restore the default session so other suites are unaffected.
        setActiveSession(null)
    }
}

// Run the focused tests that protect session-scoped file resolution.
export async function runSessionActionTests(): Promise<void> {
    testSessionFileNames()
    await testSessionIsolatesAccountFile()
}
