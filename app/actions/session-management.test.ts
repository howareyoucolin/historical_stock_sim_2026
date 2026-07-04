import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createSession, deleteSession, listSessions, readActiveSessionName, switchSession, validateSessionName } from './session-management'
import { readDefaultUserAccountSession, writeDefaultUserAccountSession } from './account/model'
import { setActiveSession } from './session'

async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate-sessmgmt-'))
}

// Validation rejects unsafe folder names and accepts simple ones.
function testValidateSessionName(): void {
    assert.equal(validateSessionName('  alpha '), 'alpha')
    assert.throws(() => validateSessionName('bad name'))
    assert.throws(() => validateSessionName('../escape'))
    assert.throws(() => validateSessionName('has.dot'))
    assert.throws(() => validateSessionName(''))
}

// Creating a session makes its own folder + fresh account and marks it active.
async function testCreateSessionMakesFolderAndActivates(): Promise<void> {
    const cwd = () => tempRepoRoot
    const tempRepoRoot = await createTempRepoRoot()
    try {
        const created = await createSession('growth', { cwd })
        assert.equal(created.name, 'growth')
        assert.equal(created.active, true)

        // Its account file lives in its own folder, and the active pointer now points to it.
        const raw = await fs.readFile(path.join(tempRepoRoot, 'user-sessions', 'growth', 'account.json'), 'utf8')
        assert.match(raw, /"cash"/)
        assert.equal(await readActiveSessionName({ cwd }), 'growth')

        // Re-creating the same name fails.
        await assert.rejects(() => createSession('growth', { cwd }), /already exists/)
    } finally {
        setActiveSession(null)
    }
}

// list/switch/delete round-trip: sessions are isolated, switching persists, delete falls back to default.
async function testListSwitchDeleteRoundTrip(): Promise<void> {
    const cwd = () => tempRepoRoot
    const tempRepoRoot = await createTempRepoRoot()
    try {
        await createSession('alpha', { cwd })
        await createSession('beta', { cwd })

        // Give each session distinct cash so isolation is observable.
        setActiveSession('alpha')
        await writeDefaultUserAccountSession({ date: '2020-01-02', cash: 111, positions: {} }, { cwd })
        setActiveSession('beta')
        await writeDefaultUserAccountSession({ date: '2020-01-02', cash: 222, positions: {} }, { cwd })

        const names = (await listSessions({ cwd })).map((session) => session.name)
        assert.deepEqual(names, ['alpha', 'beta', 'default'])

        await switchSession('alpha', { cwd })
        assert.equal(await readActiveSessionName({ cwd }), 'alpha')
        assert.equal((await readDefaultUserAccountSession({ cwd })).cash, 111)

        // Deleting the active session removes its folder and falls back to default.
        await deleteSession('alpha', { cwd })
        await assert.rejects(fs.access(path.join(tempRepoRoot, 'user-sessions', 'alpha')))
        assert.equal(await readActiveSessionName({ cwd }), 'default')

        // The default session cannot be deleted.
        await assert.rejects(() => deleteSession('default', { cwd }), /cannot be deleted/)
    } finally {
        setActiveSession(null)
    }
}

// Run the focused session-management tests.
export async function runSessionManagementTests(): Promise<void> {
    testValidateSessionName()
    await testCreateSessionMakesFolderAndActivates()
    await testListSwitchDeleteRoundTrip()
}
