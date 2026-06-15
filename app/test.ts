import { runUserSessionStoreTests } from './actions/account/model.test'
import { runInitializeAccountActionTests } from './actions/account/init.test'
import { runDepositAccountActionTests } from './actions/account/deposit.test'
import { runDownloadDataActionTests } from './actions/stock/download-data.test'
import { runCliCommandTests } from '../cli/commands.test'

// Run the project's focused TypeScript test scripts in a single entrypoint.
async function main(): Promise<void> {
    await runDownloadDataActionTests()
    await runUserSessionStoreTests()
    await runInitializeAccountActionTests()
    await runDepositAccountActionTests()
    await runCliCommandTests()
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exit(1)
})
