import { buildValuesSummary, type ValuesSummary } from '../../app/actions/account/values-summary'
import type { CommandResult } from '../command-types'

export interface ValuesCommandDependencies {
    fetchValuesSummary?: typeof buildValuesSummary
}

export const VALUES_HELP_LINES = [
    '  values show            Show the daily portfolio value history and return',
]

// Format a number with two decimals for plain-text value output.
function formatValue(value: number): string {
    return value.toFixed(2)
}

// Format a signed value/percent so gains and losses read clearly.
function formatSigned(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

// Render the value history as a compact table plus a first→last return line.
function formatValuesSummary(summary: ValuesSummary): string {
    if (summary.count === 0 || summary.first === null || summary.last === null) {
        return 'No value history yet. Advance the simulation date or trade to start tracking total value.'
    }

    const header = `Portfolio value: ${summary.first.date} → ${summary.last.date} (${summary.count} days)`
    const change = summary.change ?? 0
    const changePercent = summary.changePercent
    const returnLine = `Return: ${formatSigned(change)}${changePercent === null ? '' : ` (${formatSigned(changePercent)}%)`} | start ${formatValue(summary.first.value)} → now ${formatValue(summary.last.value)}`
    const rangeLine = `High: ${formatValue(summary.high!.value)} (${summary.high!.date}) | Low: ${formatValue(summary.low!.value)} (${summary.low!.date})`
    const rows = summary.snapshots.map((snapshot) => `  ${snapshot.date}  ${formatValue(snapshot.value)}`)

    return [header, returnLine, rangeLine, '', ...rows].join('\n')
}

// Build the values command handler so portfolio-value reporting stays out of the main router.
export function createValuesCommandHandler({ fetchValuesSummary = buildValuesSummary }: ValuesCommandDependencies = {}) {
    // Execute the `values` command family against the recorded daily total-value log.
    return async function runValuesCommand(args: string[]): Promise<CommandResult> {
        if (args[0] === 'show' && args.length === 1) {
            try {
                const summary = await fetchValuesSummary()

                return { output: formatValuesSummary(summary), data: summary, shouldExit: false, exitCode: 0 }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                return { output: `Values show failed: ${message}`, shouldExit: false, exitCode: 1 }
            }
        }

        return { output: 'Usage: values show', shouldExit: false, exitCode: 1 }
    }
}
