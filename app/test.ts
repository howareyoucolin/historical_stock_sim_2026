import { runAccountStorageTests } from './actions/account/storage.test'
import { runUserSessionStoreTests } from './actions/account/session-store.test'
import { runDownloadDataActionTests } from './actions/stock/download-data.test'
import { runCliCommandTests } from '../cli/commands.test'

// Run the project's focused TypeScript test scripts in a single entrypoint.
async function main(): Promise<void> {
    await runDownloadDataActionTests()
    await runAccountStorageTests()
    await runUserSessionStoreTests()
    await runCliCommandTests()
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exit(1)
})
