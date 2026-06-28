import { readDailyValues, trimLeadingZeroValues, type DailyValueSnapshot, type ValuesLogDependencies } from './values-log'

// A performance rollup over the recorded daily total-value series, so an agent can judge how its
// trading is doing at a glance without re-deriving figures from the raw log.
export interface ValuesSummary {
    snapshots: DailyValueSnapshot[]
    count: number
    first: DailyValueSnapshot | null
    last: DailyValueSnapshot | null
    change: number | null
    changePercent: number | null
    high: DailyValueSnapshot | null
    low: DailyValueSnapshot | null
}

// Build the daily-value series plus a first/last/high/low and total-return rollup. An empty log
// yields a summary with null figures so callers can render a friendly placeholder.
export async function buildValuesSummary(dependencies: ValuesLogDependencies = {}): Promise<ValuesSummary> {
    // Trim the leading unfunded (zero-value) period so figures start at the first funded day.
    const snapshots = trimLeadingZeroValues(await readDailyValues(dependencies))

    if (snapshots.length === 0) {
        return { snapshots, count: 0, first: null, last: null, change: null, changePercent: null, high: null, low: null }
    }

    const first = snapshots[0]
    const last = snapshots[snapshots.length - 1]
    const change = last.value - first.value
    const changePercent = first.value === 0 ? null : (change / first.value) * 100

    // Peak and trough of total value across the series, useful for drawdown-style judgments.
    let high = snapshots[0]
    let low = snapshots[0]
    for (const snapshot of snapshots) {
        if (snapshot.value > high.value) {
            high = snapshot
        }
        if (snapshot.value < low.value) {
            low = snapshot
        }
    }

    return { snapshots, count: snapshots.length, first, last, change, changePercent, high, low }
}
