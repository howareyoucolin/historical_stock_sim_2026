import { activeAccountSessionRelativePath } from '../../app/actions/session'
import { buyStockInDefaultUserAccountSession } from '../../app/actions/account/buy'
import { sellStockInDefaultUserAccountSession } from '../../app/actions/account/sell'
import { depositIntoDefaultUserAccountSession } from '../../app/actions/account/deposit'
import { initializeDefaultUserAccountSession } from '../../app/actions/account/init'
import { fetchDefaultUserAccountSessionView, formatDefaultUserAccountSessionView } from '../../app/actions/account/show'
import { getStockQuoteForAccountDate } from '../../app/actions/account/quote'
import { normalizeStockCode } from '../../app/actions/stock/download-data'
import type { DefaultUserAccountSessionView } from '../../app/actions/account/view-model'
import type { CommandResult } from '../command-types'

export interface AccountCommandDependencies {
    initializeDefaultUserAccount?: () => Promise<{ date: string; cash: number }>
    fetchAccountView?: typeof fetchDefaultUserAccountSessionView
    depositIntoDefaultUserAccount?: (valueCash: number, note?: string) => Promise<{ date: string; cash: number }>
    buyStockInDefaultUserAccount?: typeof buyStockInDefaultUserAccountSession
    sellStockInDefaultUserAccount?: typeof sellStockInDefaultUserAccountSession
    quoteStockForAccountDate?: typeof getStockQuoteForAccountDate
}

export const ACCOUNT_HELP_LINES = [
    '  account buy <code> <qty> Buy shares (also: --amount=<$>, max, --note=<text>, --dry-run)',
    '  account sell <code> <qty> Sell shares (also: all, --percent=<pct>, --note=<text>, --dry-run)',
    '  account deposit <cash> Add cash to the shared account session file (also: --note=<text>)',
    '  account init           Reset the shared account session file',
    '  account show           Show the tracked stock table for the shared account',
]

const BUY_USAGE = 'Usage: account buy <stock_code> <quantity|--amount=<dollars>|max> [--note=<text>] [--dry-run]'
const SELL_USAGE = 'Usage: account sell <stock_code> <quantity|all|--percent=<pct>> [--note=<text>] [--dry-run]'
const DEPOSIT_USAGE = 'Usage: account deposit <value_cash> [--note=<text>]'

// Format a numeric dollar amount so CLI output stays consistent for account actions.
function formatCurrency(value: number): string {
    return value.toFixed(2)
}

interface TradeFlags {
    note?: string
    amount?: number
    percent?: number
    dryRun: boolean
    positional: string[]
    error?: string
}

// Parse the shared trade flags (--note, --amount, --percent, --dry-run) out of buy/sell args,
// leaving positional tokens behind. A malformed numeric flag or unknown --flag sets `error`.
function parseTradeFlags(args: string[]): TradeFlags {
    const flags: TradeFlags = { dryRun: false, positional: [] }

    for (const arg of args) {
        if (arg === '--dry-run') {
            flags.dryRun = true
        } else if (arg.startsWith('--note=')) {
            const text = arg.slice('--note='.length)
            if (text.length > 0) {
                flags.note = text
            }
        } else if (arg.startsWith('--amount=')) {
            const value = Number(arg.slice('--amount='.length))
            if (!Number.isFinite(value)) {
                flags.error = 'Amount must be a finite number.'
            } else {
                flags.amount = value
            }
        } else if (arg.startsWith('--percent=')) {
            const value = Number(arg.slice('--percent='.length))
            if (!Number.isFinite(value)) {
                flags.error = 'Percent must be a finite number.'
            } else {
                flags.percent = value
            }
        } else if (arg.startsWith('--')) {
            flags.error = `Unknown flag: ${arg}`
        } else {
            flags.positional.push(arg)
        }
    }

    return flags
}

// Total shares currently held for a stock code in the resolved account view.
function ownedShares(view: DefaultUserAccountSessionView, stockCode: string): number {
    const lots = view.account.positions[normalizeStockCode(stockCode)] ?? []

    return lots.reduce((total, lot) => total + lot.quantity, 0)
}

// Wrap a thrown action error into the standard failed CommandResult for a labeled operation.
function failure(label: string, error: unknown): CommandResult {
    const message = error instanceof Error ? error.message : String(error)

    return { output: `${label}: ${message}`, shouldExit: false, exitCode: 1 }
}

// Build the account command handler so account-specific behavior stays out of the main router.
export function createAccountCommandHandler({
    initializeDefaultUserAccount = initializeDefaultUserAccountSession,
    fetchAccountView = fetchDefaultUserAccountSessionView,
    depositIntoDefaultUserAccount = (valueCash: number, note?: string) =>
        depositIntoDefaultUserAccountSession(valueCash, {}, note),
    buyStockInDefaultUserAccount = buyStockInDefaultUserAccountSession,
    sellStockInDefaultUserAccount = sellStockInDefaultUserAccountSession,
    quoteStockForAccountDate = getStockQuoteForAccountDate,
}: AccountCommandDependencies = {}) {
    // Run `account init`: reset the session and wipe the audit/value logs.
    async function runInit(): Promise<CommandResult> {
        try {
            const account = await initializeDefaultUserAccount()

            return {
                output: `Reset account in ${activeAccountSessionRelativePath()}.`,
                data: { action: 'init', date: account.date, cash: account.cash },
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            return failure('Account init failed', error)
        }
    }

    // Run `account show`: render the holdings table and carry the full view as JSON data.
    async function runShow(): Promise<CommandResult> {
        try {
            const view = await fetchAccountView()

            return { output: formatDefaultUserAccountSessionView(view), data: view, shouldExit: false, exitCode: 0 }
        } catch (error) {
            return failure('Account show failed', error)
        }
    }

    // Run `account deposit <cash> [--note=<text>]`: apply a (possibly negative) cash delta, with an
    // optional note recorded on the DEPOSIT history row (e.g. to mark a recurring contribution).
    async function runDeposit(args: string[]): Promise<CommandResult> {
        let note: string | undefined
        const positional: string[] = []

        for (const arg of args) {
            if (arg.startsWith('--note=')) {
                const text = arg.slice('--note='.length)
                if (text.length > 0) {
                    note = text
                }
            } else if (arg.startsWith('--')) {
                return { output: `Unknown flag: ${arg}`, shouldExit: false, exitCode: 1 }
            } else {
                positional.push(arg)
            }
        }

        if (positional.length !== 1) {
            return { output: DEPOSIT_USAGE, shouldExit: false, exitCode: 1 }
        }

        const valueCash = Number(positional[0])

        if (!Number.isFinite(valueCash)) {
            return { output: 'Cash value must be a finite number.', shouldExit: false, exitCode: 1 }
        }

        try {
            const account = await depositIntoDefaultUserAccount(valueCash, note)

            return {
                output: `Updated account cash by ${formatCurrency(valueCash)} in ${activeAccountSessionRelativePath()}.`,
                data: { action: 'deposit', cashDelta: valueCash, cash: account.cash, date: account.date, note },
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            return failure('Account deposit failed', error)
        }
    }

    // Run `account buy`: size the order from an explicit quantity, a dollar --amount, or `max`
    // (all available cash), optionally previewing it with --dry-run.
    async function runBuy(args: string[]): Promise<CommandResult> {
        const flags = parseTradeFlags(args)

        if (flags.error) {
            return { output: flags.error, shouldExit: false, exitCode: 1 }
        }

        const stockCode = flags.positional[1]
        const sizeToken = flags.positional[2]

        if (!stockCode || flags.percent !== undefined) {
            return { output: BUY_USAGE, shouldExit: false, exitCode: 1 }
        }

        if (flags.amount !== undefined && sizeToken !== undefined) {
            return { output: 'Specify either a quantity/max or --amount, not both.', shouldExit: false, exitCode: 1 }
        }

        if (flags.amount === undefined && sizeToken === undefined) {
            return { output: BUY_USAGE, shouldExit: false, exitCode: 1 }
        }

        try {
            // Resolve the order quantity and the execution price (needed for $-sizing, max, and previews).
            let quantity: number
            let price: number | undefined

            if (flags.amount !== undefined) {
                if (flags.amount <= 0) {
                    return { output: 'Amount must be a positive number.', shouldExit: false, exitCode: 1 }
                }

                price = (await quoteStockForAccountDate(stockCode)).close
                quantity = Math.floor(flags.amount / price)

                if (quantity <= 0) {
                    return { output: `Amount ${formatCurrency(flags.amount)} is below one share of ${normalizeStockCode(stockCode)} at ${formatCurrency(price)}.`, shouldExit: false, exitCode: 1 }
                }
            } else if (sizeToken === 'max') {
                const view = await fetchAccountView()
                price = (await quoteStockForAccountDate(stockCode)).close
                quantity = Math.floor(view.account.cash / price)

                if (quantity <= 0) {
                    return { output: `Not enough cash to buy a single share of ${normalizeStockCode(stockCode)} at ${formatCurrency(price)}.`, shouldExit: false, exitCode: 1 }
                }
            } else {
                quantity = Number(sizeToken)

                if (!Number.isInteger(quantity) || quantity <= 0) {
                    return { output: 'Quantity must be a positive integer.', shouldExit: false, exitCode: 1 }
                }
            }

            if (flags.dryRun) {
                if (price === undefined) {
                    price = (await quoteStockForAccountDate(stockCode)).close
                }

                const code = normalizeStockCode(stockCode)
                const estimatedCost = price * quantity

                return {
                    output: `Dry run: would buy ${quantity} ${code} at ${formatCurrency(price)} = ${formatCurrency(estimatedCost)} (no changes made).`,
                    data: { action: 'buy', dryRun: true, stockCode: code, quantity, price, estimatedCost },
                    shouldExit: false,
                    exitCode: 0,
                }
            }

            const result = await buyStockInDefaultUserAccount(stockCode, quantity, undefined, flags.note)

            return {
                output: `${result.quantity} stocks of ${result.stockCode} successfully bought.`,
                data: {
                    action: 'buy',
                    dryRun: false,
                    stockCode: result.stockCode,
                    quantity: result.quantity,
                    price: result.costPerShare,
                    totalCost: result.totalCost,
                    cash: result.account.cash,
                    note: flags.note,
                },
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            return failure('Account buy failed', error)
        }
    }

    // Run `account sell`: size from an explicit quantity, `all`, or --percent of owned shares,
    // optionally previewing it with --dry-run.
    async function runSell(args: string[]): Promise<CommandResult> {
        const flags = parseTradeFlags(args)

        if (flags.error) {
            return { output: flags.error, shouldExit: false, exitCode: 1 }
        }

        const stockCode = flags.positional[1]
        const sizeToken = flags.positional[2]

        if (!stockCode || flags.amount !== undefined) {
            return { output: SELL_USAGE, shouldExit: false, exitCode: 1 }
        }

        if (flags.percent !== undefined && sizeToken !== undefined) {
            return { output: 'Specify either a quantity/all or --percent, not both.', shouldExit: false, exitCode: 1 }
        }

        if (flags.percent === undefined && sizeToken === undefined) {
            return { output: SELL_USAGE, shouldExit: false, exitCode: 1 }
        }

        try {
            // Resolve the sell quantity, reading owned shares only when `all`/--percent needs them.
            let quantity: number

            if (flags.percent !== undefined) {
                if (flags.percent <= 0 || flags.percent > 100) {
                    return { output: 'Percent must be between 0 and 100.', shouldExit: false, exitCode: 1 }
                }

                const owned = ownedShares(await fetchAccountView(), stockCode)

                if (owned <= 0) {
                    return { output: `You do not own any shares of ${normalizeStockCode(stockCode)}.`, shouldExit: false, exitCode: 1 }
                }

                quantity = Math.floor((owned * flags.percent) / 100)

                if (quantity <= 0) {
                    return { output: `Selling ${flags.percent}% of ${owned} shares rounds down to zero.`, shouldExit: false, exitCode: 1 }
                }
            } else if (sizeToken === 'all') {
                quantity = ownedShares(await fetchAccountView(), stockCode)

                if (quantity <= 0) {
                    return { output: `You do not own any shares of ${normalizeStockCode(stockCode)}.`, shouldExit: false, exitCode: 1 }
                }
            } else {
                quantity = Number(sizeToken)

                if (!Number.isInteger(quantity) || quantity <= 0) {
                    return { output: 'Quantity must be a positive integer.', shouldExit: false, exitCode: 1 }
                }
            }

            if (flags.dryRun) {
                const code = normalizeStockCode(stockCode)
                const price = (await quoteStockForAccountDate(stockCode)).close
                const estimatedProceeds = price * quantity

                return {
                    output: `Dry run: would sell ${quantity} ${code} at ${formatCurrency(price)} = ${formatCurrency(estimatedProceeds)} (no changes made).`,
                    data: { action: 'sell', dryRun: true, stockCode: code, quantity, price, estimatedProceeds },
                    shouldExit: false,
                    exitCode: 0,
                }
            }

            const result = await sellStockInDefaultUserAccount(stockCode, quantity, undefined, flags.note)

            return {
                output: `${result.quantity} stocks of ${result.stockCode} successfully sold.`,
                data: {
                    action: 'sell',
                    dryRun: false,
                    stockCode: result.stockCode,
                    quantity: result.quantity,
                    price: result.pricePerShare,
                    totalProceeds: result.totalProceeds,
                    cash: result.account.cash,
                    note: flags.note,
                },
                shouldExit: false,
                exitCode: 0,
            }
        } catch (error) {
            return failure('Account sell failed', error)
        }
    }

    // Execute the `account` command family against the shared account session file.
    return async function runAccountCommand(args: string[]): Promise<CommandResult> {
        switch (args[0]) {
            case 'init':
                return args.length === 1 ? runInit() : { output: 'Usage: account init', shouldExit: false, exitCode: 1 }
            case 'show':
                return args.length === 1 ? runShow() : { output: 'Usage: account show', shouldExit: false, exitCode: 1 }
            case 'deposit':
                return runDeposit(args.slice(1))
            case 'buy':
                return runBuy(args)
            case 'sell':
                return runSell(args)
            default:
                return {
                    output: 'Usage: account <init|show|deposit <value_cash>|buy <stock_code> <quantity>|sell <stock_code> <quantity>>',
                    shouldExit: false,
                    exitCode: 1,
                }
        }
    }
}
