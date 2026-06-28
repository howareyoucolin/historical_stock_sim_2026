import { runUserSessionStoreTests } from './actions/account/model.test'
import { runBuyAccountActionTests } from './actions/account/buy.test'
import { runSellAccountActionTests } from './actions/account/sell.test'
import { runInitializeAccountActionTests } from './actions/account/init.test'
import { runDepositAccountActionTests } from './actions/account/deposit.test'
import { runShowAccountActionTests } from './actions/account/show.test'
import { runValuesLogActionTests } from './actions/account/values-log.test'
import { runCashInterestTests } from './actions/account/cash-interest.test'
import { runHistoryLogActionTests } from './actions/history/log.test'
import { runBuildSimulationReportTests } from './actions/report/build.test'
import { runReadSimulationReportTests } from './actions/report/read.test'
import { runCorporateActionDateAdvanceTests } from './actions/date/corporate-actions.test'
import { runSetDateToSpecificDateActionTests } from './actions/date/set-to-specific-date.test'
import { runSetDateToTomorrowActionTests } from './actions/date/set-to-tomorrow.test'
import { runStockHistoryActionTests } from './actions/stock/history.test'
import { runStockInfoActionTests } from './actions/stock/info.test'
import { runStockStatusActionTests } from './actions/stock/status.test'
import { runStockListActionTests } from './actions/stock/list.test'
import { runStockAnalysisActionTests } from './actions/stock/analysis.test'
import { runSessionActionTests } from './actions/session.test'
import { runTaxReportTests } from './components/AccountPanel/Content/Summary/TaxReport/taxReport.test'
import { runCliCommandTests } from '../cli/commands.test'
import { runCliOutputTests } from '../cli/output.test'

const GREEN = '\u001b[32m'
const RED = '\u001b[31m'
const WHITE = '\u001b[37m'
const RESET = '\u001b[0m'
const SUMMARY_SEPARATOR = '-------------------------------------------'

// Fail loudly if any test reaches the real market-data API instead of injecting a fake. Without this
// guard an un-injected dependency silently hits the live PHP API under Node 18+ (where fetch exists)
// and the test "passes" by accident, while breaking under older Node or when the API is down.
globalThis.fetch = (() => {
    throw new Error('A test reached the network via fetch(). Inject a fake (e.g. getStockData / getTradingCalendar / getCorporateActions) instead of hitting the market-data API.')
}) as typeof fetch

interface TestSuite {
    label: string
    run: () => Promise<void>
}

const TEST_SUITES: TestSuite[] = [
    { label: 'Stock history action tests', run: runStockHistoryActionTests },
    { label: 'Stock info action tests', run: runStockInfoActionTests },
    { label: 'Stock status action tests', run: runStockStatusActionTests },
    { label: 'Stock list action tests', run: runStockListActionTests },
    { label: 'Stock analysis action tests', run: runStockAnalysisActionTests },
    { label: 'User session store tests', run: runUserSessionStoreTests },
    { label: 'Account buy action tests', run: runBuyAccountActionTests },
    { label: 'Account sell action tests', run: runSellAccountActionTests },
    { label: 'Account init action tests', run: runInitializeAccountActionTests },
    { label: 'Account deposit action tests', run: runDepositAccountActionTests },
    { label: 'Account show action tests', run: runShowAccountActionTests },
    { label: 'Values log action tests', run: runValuesLogActionTests },
    { label: 'Parked-cash interest tests', run: runCashInterestTests },
    { label: 'History log action tests', run: runHistoryLogActionTests },
    { label: 'Simulation report build tests', run: runBuildSimulationReportTests },
    { label: 'Simulation report read tests', run: runReadSimulationReportTests },
    { label: 'Corporate action date-advance tests', run: runCorporateActionDateAdvanceTests },
    { label: 'Date next action tests', run: runSetDateToTomorrowActionTests },
    { label: 'Date set action tests', run: runSetDateToSpecificDateActionTests },
    { label: 'Session action tests', run: runSessionActionTests },
    { label: 'Tax report tests', run: runTaxReportTests },
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
