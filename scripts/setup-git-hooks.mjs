import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectoryPath = path.dirname(fileURLToPath(import.meta.url))
const repoRootPath = path.resolve(scriptDirectoryPath, '..')
const hookFilePath = path.join(repoRootPath, '.githooks', 'pre-commit')

// Ensure the tracked pre-commit hook is executable before Git tries to run it.
async function ensureHookIsExecutable() {
    await fs.chmod(hookFilePath, 0o755)
}

// Point the local repository at the tracked hooks directory so every commit runs the same checks.
function configureGitHooksPath() {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
        cwd: repoRootPath,
        stdio: 'inherit',
    })
}

await ensureHookIsExecutable()
configureGitHooksPath()
