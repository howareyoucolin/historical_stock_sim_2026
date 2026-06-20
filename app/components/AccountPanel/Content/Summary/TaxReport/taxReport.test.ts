import assert from 'node:assert/strict'

import { buildTaxReport, TAX_RATES } from './taxReport'

// A small, realistic history fixture: one buy paired with a profitable long-term sell, a separate
// buy paired with a losing short-term sell, two dividends, and a deposit/note to confirm they are
// ignored. Spans two years so grouping and totals are both exercised.
const HISTORY: string[] = [
    '2026-01-01T00:00:00Z DEPOSIT cash=+100000.00 sim=2016-01-04',
    '2026-01-01T00:00:01Z BUY stock=AAPL qty=100 price=10.00 cash=-1000.00 sim=2016-01-04 note="entry"',
    '2026-01-01T00:00:02Z BUY stock=MSFT qty=50 price=20.00 cash=-1000.00 sim=2016-06-01',
    '2026-01-01T00:00:03Z DIVIDEND stock=AAPL qty=100 price=0.50 cash=+50.00 sim=2016-09-01',
    '2026-01-01T00:00:04Z SELL stock=MSFT qty=50 price=16.00 acquired=2016-06-01 term=SHORT cash=+800.00 sim=2016-11-01 note="cut loss"',
    '2026-01-01T00:00:05Z DIVIDEND stock=AAPL qty=100 price=0.60 cash=+60.00 sim=2017-03-01',
    '2026-01-01T00:00:06Z SELL stock=AAPL qty=100 price=18.00 acquired=2016-01-04 term=LONG cash=+1800.00 sim=2017-05-01',
]

// Verify gains are reconstructed by term and year, dividends accumulate, and non-trade lines are ignored.
function testBuildsPerYearGains(): void {
    const report = buildTaxReport(HISTORY)

    assert.equal(report.years.length, 2)

    const [y2016, y2017] = report.years
    assert.equal(y2016.year, '2016')
    // MSFT short-term loss: (16 - 20) * 50 = -200; no long-term gain in 2016.
    assert.equal(y2016.shortTermGain, -200)
    assert.equal(y2016.longTermGain, 0)
    assert.equal(y2016.dividendGain, 50)
    assert.equal(y2016.interestGain, 0)

    assert.equal(y2017.year, '2017')
    // AAPL long-term gain: (18 - 10) * 100 = 800.
    assert.equal(y2017.longTermGain, 800)
    assert.equal(y2017.shortTermGain, 0)
    assert.equal(y2017.dividendGain, 60)
}

// Verify per-category tax: positive categories taxed at their rate, loss categories owe nothing,
// and the total is the sum of the category taxes.
function testEstimatedTax(): void {
    const report = buildTaxReport(HISTORY)
    const [y2016, y2017] = report.years

    // 2016: short-term net loss => no short-term tax; only the $50 dividend is taxed.
    assert.equal(y2016.shortTermTax, 0)
    assert.equal(y2016.longTermTax, 0)
    assert.equal(y2016.dividendTax, 50 * TAX_RATES.dividend)
    assert.equal(y2016.interestTax, 0)
    assert.equal(y2016.estimatedTax, y2016.longTermTax + y2016.shortTermTax + y2016.dividendTax + y2016.interestTax)
    assert.equal(y2016.estimatedTax, 50 * TAX_RATES.dividend)

    // 2017: $800 long-term gain + $60 dividend, each taxed at its category rate.
    assert.equal(y2017.longTermTax, 800 * TAX_RATES.longTerm)
    assert.equal(y2017.dividendTax, 60 * TAX_RATES.dividend)
    assert.equal(y2017.estimatedTax, 800 * TAX_RATES.longTerm + 60 * TAX_RATES.dividend)
}

// Verify the total row sums each column and the per-year estimated taxes.
function testTotalsRow(): void {
    const report = buildTaxReport(HISTORY)
    const { total } = report

    assert.equal(total.year, 'Total')
    assert.equal(total.longTermGain, 800)
    assert.equal(total.shortTermGain, -200)
    assert.equal(total.dividendGain, 110)
    // Per-category taxes also roll up, and the total tax is their sum across years.
    assert.equal(total.longTermTax, report.years[1].longTermTax)
    assert.equal(total.dividendTax, report.years[0].dividendTax + report.years[1].dividendTax)
    assert.equal(total.estimatedTax, total.longTermTax + total.shortTermTax + total.dividendTax + total.interestTax)
    assert.equal(total.estimatedTax, report.years[0].estimatedTax + report.years[1].estimatedTax)
}

// Verify a sell with no matching buy is skipped (cost basis unknown) rather than mis-valued, and that
// an empty log yields an empty report with a zeroed total.
function testEdgeCases(): void {
    const orphanSell = ['2026-01-01T00:00:00Z SELL stock=XYZ qty=10 price=5.00 acquired=2015-01-01 term=LONG cash=+50.00 sim=2016-01-01']
    const report = buildTaxReport(orphanSell)
    assert.equal(report.years.length, 0)
    assert.equal(report.total.estimatedTax, 0)

    const empty = buildTaxReport([])
    assert.equal(empty.years.length, 0)
    assert.equal(empty.total.longTermGain, 0)
}

// Run the focused realized-gain and estimated-tax report tests.
export async function runTaxReportTests(): Promise<void> {
    testBuildsPerYearGains()
    testEstimatedTax()
    testTotalsRow()
    testEdgeCases()
}
