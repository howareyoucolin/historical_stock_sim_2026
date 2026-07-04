import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { initializeDefaultUserAccountSession } from './init'
import { appendHistoryEvent, HISTORY_LOG_RELATIVE_PATH } from '../history/log'
import { createDefaultAccountState, readDefaultUserAccountSession, writeDefaultUserAccountSession } from './model'
import { setActiveSession } from '../session'

const DEFAULT_ACCOUNT_STATE = createDefaultAccountState()

// Build a temporary repo root so init action tests can mutate an isolated session file.
async function createTempRepoRoot(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'stocksimulate2026-'))
}

// Verify account init replaces any previous account data with the default account object.
async function testInitializeDefaultUserAccountSession(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()

    await writeDefaultUserAccountSession(
        {
            date: '2018-03-10',
            cash: 1200,
            positions: {
                AAPL: [
                    {
                        quantity: 3,
                        cost_per_share: 200,
                        purchase_date: '2026-06-15',
                    },
                ],
            },
        },
        {
            cwd: () => tempRepoRoot,
        }
    )

    const account = await initializeDefaultUserAccountSession({
        cwd: () => tempRepoRoot,
    })
    const savedAccount = await readDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    assert.deepEqual(account, DEFAULT_ACCOUNT_STATE)
    assert.deepEqual(savedAccount, DEFAULT_ACCOUNT_STATE)
}

// Verify account init wipes the history log so the audit trail matches the reset account.
async function testInitializeDefaultUserAccountSessionClearsHistory(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const logFilePath = path.join(tempRepoRoot, HISTORY_LOG_RELATIVE_PATH)

    await appendHistoryEvent(
        { type: 'DEPOSIT', simDate: '2016-01-04', cashDelta: 1000 },
        { cwd: () => tempRepoRoot }
    )

    await initializeDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    await assert.rejects(() => fs.readFile(logFilePath, 'utf8'), /ENOENT/)
}

// Verify default init is scoped to the default session's own folder: it resets user-sessions/default/
// but leaves sibling sessions and unrelated files intact (init no longer wipes the whole directory).
async function testDefaultInitIsScopedToDefaultFolder(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const sessionsDirectory = path.join(tempRepoRoot, 'user-sessions')

    // Seed a sibling named session folder and an unrelated file that must survive a default init.
    await fs.mkdir(path.join(sessionsDirectory, 'voo'), { recursive: true })
    await fs.writeFile(path.join(sessionsDirectory, 'voo', 'account.json'), '{"keep":"sibling"}', 'utf8')
    await fs.writeFile(path.join(sessionsDirectory, 'stray.txt'), 'x', 'utf8')

    await initializeDefaultUserAccountSession({ cwd: () => tempRepoRoot })

    const remaining = (await fs.readdir(sessionsDirectory)).sort()
    // A fresh default/ folder is created; the sibling session and stray file are untouched.
    assert.deepEqual(remaining, ['default', 'stray.txt', 'voo'])
    assert.deepEqual((await fs.readdir(path.join(sessionsDirectory, 'default'))).sort(), ['account.json', 'meta.json'])
    assert.equal(await fs.readFile(path.join(sessionsDirectory, 'voo', 'account.json'), 'utf8'), '{"keep":"sibling"}')
}

// Verify a NAMED session's init resets only its own folder, leaving the default session and sibling
// sessions intact (the scoping that stops a `--session=X` init from wiping everything).
async function testNamedSessionInitIsScopedToItsOwnFolder(): Promise<void> {
    const tempRepoRoot = await createTempRepoRoot()
    const sessionsDirectory = path.join(tempRepoRoot, 'user-sessions')

    await fs.mkdir(path.join(sessionsDirectory, 'default'), { recursive: true })
    await fs.writeFile(path.join(sessionsDirectory, 'default', 'account.json'), '{"keep":"default"}', 'utf8')
    await fs.mkdir(path.join(sessionsDirectory, 'spy'), { recursive: true })
    await fs.writeFile(path.join(sessionsDirectory, 'spy', 'account.json'), '{"keep":"sibling"}', 'utf8')
    // The target session's own stale leftovers, which init should clear.
    await fs.mkdir(path.join(sessionsDirectory, 'voo'), { recursive: true })
    await fs.writeFile(path.join(sessionsDirectory, 'voo', 'history.log'), 'x', 'utf8')

    try {
        setActiveSession('voo')
        await initializeDefaultUserAccountSession({ cwd: () => tempRepoRoot })
    } finally {
        setActiveSession(null)
    }

    // Default + sibling untouched; voo reset to a fresh account+meta with its stale log gone.
    assert.equal(await fs.readFile(path.join(sessionsDirectory, 'default', 'account.json'), 'utf8'), '{"keep":"default"}')
    assert.equal(await fs.readFile(path.join(sessionsDirectory, 'spy', 'account.json'), 'utf8'), '{"keep":"sibling"}')
    assert.deepEqual((await fs.readdir(path.join(sessionsDirectory, 'voo'))).sort(), ['account.json', 'meta.json'])
    await assert.rejects(() => fs.readFile(path.join(sessionsDirectory, 'voo', 'history.log'), 'utf8'), /ENOENT/)
}

// Run the focused init action tests that protect the account reset flow.
export async function runInitializeAccountActionTests(): Promise<void> {
    await testInitializeDefaultUserAccountSession()
    await testInitializeDefaultUserAccountSessionClearsHistory()
    await testDefaultInitIsScopedToDefaultFolder()
    await testNamedSessionInitIsScopedToItsOwnFolder()
}
