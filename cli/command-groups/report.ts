import { activeReportRelativePath } from '../../app/actions/session'
import { buildSimulationReport, type BuildSimulationReportResult, type ReportBuildOptions } from '../../app/actions/report/build'
import type { CommandResult } from '../command-types'

export interface ReportCommandDependencies {
    buildReport?: typeof buildSimulationReport
}

export const REPORT_HELP_LINES = [
    '  report build           Build a compact simulation report JSON for the active session',
]

const REPORT_BUILD_USAGE =
    'Usage: report build [--out=<path>] [--strategy=<name>] [--strategy-version=<version>] [--strategy-summary=<text>] [--thesis-summary=<text>] [--objective=<title>] [--objective-metric=<metric>] [--objective-constraint=<text>] [--market-regime=<label>] [--volatility-level=<label>] [--note=<text>]'

function parseReportBuildOptions(args: string[]): ReportBuildOptions & { error?: string } {
    const options: ReportBuildOptions & { error?: string } = {
        objectiveConstraints: [],
    }

    for (const arg of args) {
        if (arg.startsWith('--out=')) {
            options.outputPath = arg.slice('--out='.length)
        } else if (arg.startsWith('--strategy=')) {
            options.strategyName = arg.slice('--strategy='.length)
        } else if (arg.startsWith('--strategy-version=')) {
            options.strategyVersion = arg.slice('--strategy-version='.length)
        } else if (arg.startsWith('--strategy-summary=')) {
            options.strategySummary = arg.slice('--strategy-summary='.length)
        } else if (arg.startsWith('--thesis-summary=')) {
            options.thesisSummary = arg.slice('--thesis-summary='.length)
        } else if (arg.startsWith('--objective=')) {
            options.objectiveTitle = arg.slice('--objective='.length)
        } else if (arg.startsWith('--objective-metric=')) {
            options.objectivePrimaryMetric = arg.slice('--objective-metric='.length)
        } else if (arg.startsWith('--objective-constraint=')) {
            options.objectiveConstraints!.push(arg.slice('--objective-constraint='.length))
        } else if (arg.startsWith('--market-regime=')) {
            options.marketRegime = arg.slice('--market-regime='.length)
        } else if (arg.startsWith('--volatility-level=')) {
            options.volatilityLevel = arg.slice('--volatility-level='.length)
        } else if (arg.startsWith('--note=')) {
            options.note = arg.slice('--note='.length)
        } else {
            options.error = `Unknown report flag: ${arg}`
        }
    }

    return options
}

function formatBuildReportMessage(result: BuildSimulationReportResult): string {
    return `Built report at ${result.outputPath || activeReportRelativePath()}.`
}

export function createReportCommandHandler({ buildReport = buildSimulationReport }: ReportCommandDependencies = {}) {
    // Execute the `report` command family against the active session's account, history, and values files.
    return async function runReportCommand(args: string[]): Promise<CommandResult> {
        if (args[0] === 'build') {
            const options = parseReportBuildOptions(args.slice(1))

            if (options.error) {
                return { output: options.error, shouldExit: false, exitCode: 1 }
            }

            try {
                const result = await buildReport(options)

                return {
                    output: formatBuildReportMessage(result),
                    data: result.report,
                    shouldExit: false,
                    exitCode: 0,
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                return { output: `Report build failed: ${message}`, shouldExit: false, exitCode: 1 }
            }
        }

        return { output: REPORT_BUILD_USAGE, shouldExit: false, exitCode: 1 }
    }
}
