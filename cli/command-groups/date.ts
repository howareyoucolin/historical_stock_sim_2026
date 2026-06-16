import { setDefaultUserAccountDateToSpecificDate } from '../../app/actions/date/set-to-specific-date'
import { setDefaultUserAccountDateToTomorrow } from '../../app/actions/date/set-to-tomorrow'
import type { CommandResult } from '../command-types'

interface DateResult {
    date: string
}

export interface DateCommandDependencies {
    setDefaultUserAccountDateToTomorrow?: () => Promise<DateResult>
    setDefaultUserAccountDateToSpecificDate?: (specificDate: string) => Promise<DateResult>
}

export const DATE_HELP_LINES = [
    '  date next              Advance to the next market trading day',
    '  date set <yyyy-mm-dd>  Set the simulation date directly',
]

// Build the date command handler so simulation date updates live outside the main router.
export function createDateCommandHandler({
    setDefaultUserAccountDateToTomorrow: setDateToTomorrow = setDefaultUserAccountDateToTomorrow,
    setDefaultUserAccountDateToSpecificDate: setDateToSpecificDate = setDefaultUserAccountDateToSpecificDate,
}: DateCommandDependencies = {}) {
    // Execute the `date` command family against the shared simulation date state.
    return async function runDateCommand(args: string[]): Promise<CommandResult> {
        if (args[0] === 'next' && args.length === 1) {
            try {
                const account = await setDateToTomorrow()

                return {
                    output: `Advanced simulation date to ${account.date}.`,
                    shouldExit: false,
                    exitCode: 0,
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                return {
                    output: `Date next failed: ${message}`,
                    shouldExit: false,
                    exitCode: 1,
                }
            }
        }

        if (args[0] === 'set' && args.length === 2) {
            try {
                const account = await setDateToSpecificDate(args[1])

                return {
                    output: `Set simulation date to ${account.date}.`,
                    shouldExit: false,
                    exitCode: 0,
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                return {
                    output: `Date set failed: ${message}`,
                    shouldExit: false,
                    exitCode: 1,
                }
            }
        }

        if (args[0] === 'set') {
            return {
                output: 'Usage: date set <yyyy-mm-dd>',
                shouldExit: false,
                exitCode: 1,
            }
        }

        return {
            output: args[0] ? 'Usage: date <next|set <yyyy-mm-dd>>' : 'Usage: date next',
            shouldExit: false,
            exitCode: 1,
        }
    }
}
