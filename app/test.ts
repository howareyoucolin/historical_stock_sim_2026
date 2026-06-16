import { runUserSessionStoreTests } from './actions/account/model.test'
import { runBuyAccountActionTests } from './actions/account/buy.test'
import { runSellAccountActionTests } from './actions/account/sell.test'
import { runInitializeAccountActionTests } from './actions/account/init.test'
import { runDepositAccountActionTests } from './actions/account/deposit.test'
import { runShowAccountActionTests } from './actions/account/show.test'
import { runSetDateToSpecificDateActionTests } from './actions/date/set-to-specific-date.test'
import { runSetDateToTomorrowActionTests } from './actions/date/set-to-tomorrow.test'
import { runDownloadDataActionTests } from './actions/stock/download-data.test'
import { runBuildDataActionTests } from './actions/stock/build-data.test'
import { runScrapeEpsActionTests } from './actions/stock/scrape-eps.test'
import { runSeedWatchlistActionTests } from './actions/stock/seed-watchlist.test'
import { runCliCommandTests } from '../cli/commands.test'
import { runCliOutputTests } from '../cli/output.test'

const GREEN = '\u001b[32m'
const RED = '\u001b[31m'
const WHITE = '\u001b[37m'
const RESET = '\u001b[0m'
const SUMMARY_SEPARATOR = '-------------------------------------------'

interface TestSuite {
    label: string
    run: () => Promise<void>
}

const TEST_SUITES: TestSuite[] = [
    { label: 'Download stock data action tests', run: runDownloadDataActionTests },
    { label: 'Build stock data action tests', run: runBuildDataActionTests },
    { label: 'Scrape stock EPS action tests', run: runScrapeEpsActionTests },
    { label: 'Seed watchlist action tests', run: runSeedWatchlistActionTests },
    { label: 'User session store tests', run: runUserSessionStoreTests },
    { label: 'Account buy action tests', run: runBuyAccountActionTests },
    { label: 'Account sell action tests', run: runSellAccountActionTests },
    { label: 'Account init action tests', run: runInitializeAccountActionTests },
    { label: 'Account deposit action tests', run: runDepositAccountActionTests },
    { label: 'Account show action tests', run: runShowAccountActionTests },
    { label: 'Date next action tests', run: runSetDateToTomorrowActionTests },
    { label: 'Date set action tests', run: runSetDateToSpecificDateActionTests },
    { label: 'CLI command tests', run: runCliCommandTests },
    { label: 'CLI output tests', run: runCliOutputTests },
]

// Wrap a message in ANSI color codes so test output is easier to scan in the terminal.
function colorize(color: string, message: string): string {
    return `${color}${message}${RESET}`
}

// Build a single test status line with an independently colored symbol and label.
function formatStatusLine(icon: string, iconColor: string, label: string, labelColor: string): string {
    return `${colorize(iconColor, icon)} ${colorize(labelColor, label)}`
}

// Build the separator used to frame the final test summary block.
function formatSummarySeparator(): string {
    return colorize(WHITE, SUMMARY_SEPARATOR)
}

// Normalize thrown values into readable terminal output for failed test suites.
function formatFailureDetails(error: unknown): string {
    const message = error instanceof Error ? error.stack || error.message : String(error)

    return colorize(RED, `${message}`)
}

// Run every focused test suite, print styled output, and count any failures.
async function runTestSuites(): Promise<number> {
    let failedSuiteCount = 0

    for (const testSuite of TEST_SUITES) {
        try {
            await testSuite.run()
            console.log(formatStatusLine('✓', GREEN, testSuite.label, WHITE))
        } catch (error) {
            failedSuiteCount += 1
            console.error(formatStatusLine('✗', RED, testSuite.label, WHITE))
            console.error(formatFailureDetails(error))
        }
    }

    return failedSuiteCount
}

// Run the project's focused TypeScript test scripts and print a colored summary at the end.
async function main(): Promise<void> {
    const failedSuiteCount = await runTestSuites()
    const passedSuiteCount = TEST_SUITES.length - failedSuiteCount

    if (failedSuiteCount === 0) {
        console.log(formatSummarySeparator())
        console.log(formatStatusLine('✓', GREEN, `All ${passedSuiteCount} test suites passed.`, WHITE))
        console.log(formatSummarySeparator())
        console.log()
        return
    }

    console.error(formatSummarySeparator())
    console.error(formatStatusLine('✗', RED, `${failedSuiteCount} of ${TEST_SUITES.length} test suites failed.`, WHITE))
    console.error(formatSummarySeparator())
    console.error()
    process.exit(1)
}

void main().catch((error: unknown) => {
    console.error(formatFailureDetails(error))
    process.exit(1)
})
