import { advanceSimulationDate, type AdvanceSimulationResult, type InterestPayout } from '../../app/actions/date/advance'
import { fetchDefaultUserAccountSession } from '../../app/actions/account/show'
import type { CommandResult } from '../command-types'

export interface DateCommandDependencies {
    advanceOneTradingDay?: () => Promise<AdvanceSimulationResult>
    advanceToSpecificDate?: (specificDate: string) => Promise<AdvanceSimulationResult>
    fetchAccountSession?: typeof fetchDefaultUserAccountSession
}

export const DATE_HELP_LINES = [
    '  date show              Print the current simulation date',
    '  date next [n]          Advance n market trading days (default 1)',
    '  date set <yyyy-mm-dd>  Advance the simulation date to a target day',
]

// Summarize dividends credited while advancing so an agent sees passive income inline.
function dividendSuffix(dividends: AdvanceSimulationResult['dividends'], totalDividends: number): string {
    if (dividends.length === 0) {
        return ''
    }

    return ` Credited ${totalDividends.toFixed(2)} in dividends across ${dividends.length} payout${dividends.length === 1 ? '' : 's'}.`
}

// Summarize interest paid on parked cash so an agent sees passive cash yield inline.
function interestSuffix(interest: InterestPayout[], totalInterest: number): string {
    if (interest.length === 0) {
        return ''
    }

    return ` Paid ${totalInterest.toFixed(2)} in interest on cash across ${interest.length} payout${interest.length === 1 ? '' : 's'}.`
}

// Build the date command handler so simulation date updates live outside the main router.
export function createDateCommandHandler({
    advanceOneTradingDay = () => advanceSimulationDate(null),
    advanceToSpecificDate = (specificDate: string) => advanceSimulationDate(specificDate),
    fetchAccountSession = fetchDefaultUserAccountSession,
}: DateCommandDependencies = {}) {
    // Run `date show`: report the current simulation date without changing it.
    async function runShow(): Promise<CommandResult> {
        try {
            const account = await fetchAccountSession()

            return { output: `Simulation date: ${account.date}.`, data: { date: account.date }, shouldExit: false, exitCode: 0 }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Date show failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `date next [n]`: step forward n trading days, accumulating dividends credited along the way.
    async function runNext(args: string[]): Promise<CommandResult> {
        const steps = args.length === 0 ? 1 : Number(args[0])

        if (!Number.isInteger(steps) || steps <= 0) {
            return { output: 'Usage: date next [n] (n must be a positive integer)', shouldExit: false, exitCode: 1 }
        }

        try {
            const dividends: AdvanceSimulationResult['dividends'] = []
            const interest: InterestPayout[] = []
            let date = ''

            // Each step advances exactly one trading day; looping accumulates multi-day dividend and
            // interest credits across the span.
            for (let step = 0; step < steps; step += 1) {
                const result = await advanceOneTradingDay()
                dividends.push(...result.dividends)
                interest.push(...(result.interest ?? []))
                date = result.account.date
            }

            const totalDividends = dividends.reduce((total, dividend) => total + dividend.amount, 0)
            const totalInterest = interest.reduce((total, payout) => total + payout.amount, 0)
            const lead = steps === 1 ? `Advanced simulation date to ${date}.` : `Advanced ${steps} trading days to ${date}.`

            return {
                output: `${lead}${dividendSuffix(dividends, totalDividends)}${interestSuffix(interest, totalInterest)}`,
                data: { date, steps, dividends, totalDividends, interest, totalInterest },
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Date next failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Run `date set <yyyy-mm-dd>`: advance to a target day, crediting dividends on each payout between.
    async function runSet(args: string[]): Promise<CommandResult> {
        if (args.length !== 1) {
            return { output: 'Usage: date set <yyyy-mm-dd>', shouldExit: false, exitCode: 1 }
        }

        try {
            const result = await advanceToSpecificDate(args[0])
            const date = result.account.date
            const interest = result.interest ?? []
            const totalInterest = result.totalInterest ?? 0

            return {
                output: `Set simulation date to ${date}.${dividendSuffix(result.dividends, result.totalDividends)}${interestSuffix(interest, totalInterest)}`,
                data: { date, dividends: result.dividends, totalDividends: result.totalDividends, interest, totalInterest },
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            return { output: `Date set failed: ${message}`, shouldExit: false, exitCode: 1 }
        }
    }

    // Execute the `date` command family against the shared simulation date state.
    return async function runDateCommand(args: string[]): Promise<CommandResult> {
        switch (args[0]) {
            case 'show':
                return args.length === 1 ? runShow() : { output: 'Usage: date show', shouldExit: false, exitCode: 1 }
            case 'next':
                return runNext(args.slice(1))
            case 'set':
                return runSet(args.slice(1))
            default:
                return { output: 'Usage: date <show|next [n]|set <yyyy-mm-dd>>', shouldExit: false, exitCode: 1 }
        }
    }
}
