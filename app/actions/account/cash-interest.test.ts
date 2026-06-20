import assert from 'node:assert/strict'

import { accrueInterestOverGap, annualRateForYear, DAYS_PER_YEAR, SPAXX_ANNUAL_RATES } from './cash-interest'

// Verify the annual rate lookup returns table values and clamps years outside the modeled range.
function testAnnualRateForYear(): void {
    assert.equal(annualRateForYear(2016), SPAXX_ANNUAL_RATES[2016])
    assert.equal(annualRateForYear(2023), SPAXX_ANNUAL_RATES[2023])
    // Years before/after the table clamp to the nearest known year rather than returning zero.
    assert.equal(annualRateForYear(2010), SPAXX_ANNUAL_RATES[2016])
    assert.equal(annualRateForYear(2030), SPAXX_ANNUAL_RATES[2026])
}

// Verify a one-day accrual equals balance * dailyRate, and that empty/degenerate gaps accrue nothing.
function testSingleDayAndDegenerateGaps(): void {
    const oneDay = accrueInterestOverGap(1000, '2023-06-01', '2023-06-02')
    assert.equal(oneDay, 1000 * (SPAXX_ANNUAL_RATES[2023] / DAYS_PER_YEAR))

    assert.equal(accrueInterestOverGap(0, '2023-06-01', '2023-07-01'), 0)
    assert.equal(accrueInterestOverGap(-500, '2023-06-01', '2023-07-01'), 0)
    assert.equal(accrueInterestOverGap(1000, '2023-06-01', '2023-06-01'), 0)
}

// Verify the gap is exclusive of fromDate and inclusive of toDate (counts the right number of days).
function testGapDayCount(): void {
    // 2023-06-01 -> 2023-06-04 spans 06-02, 06-03, 06-04 = three daily accruals.
    const threeDays = accrueInterestOverGap(1000, '2023-06-01', '2023-06-04')
    assert.equal(threeDays, 3 * (1000 * (SPAXX_ANNUAL_RATES[2023] / DAYS_PER_YEAR)))
}

// Verify a gap spanning a year boundary rates each day by its own calendar year.
function testYearBoundarySplit(): void {
    // 2021-12-30 -> 2022-01-01 accrues 12-31 (2021 rate) and 01-01 (2022 rate).
    const acrossNewYear = accrueInterestOverGap(1000, '2021-12-30', '2022-01-01')
    const expected = 1000 * (SPAXX_ANNUAL_RATES[2021] / DAYS_PER_YEAR) + 1000 * (SPAXX_ANNUAL_RATES[2022] / DAYS_PER_YEAR)
    assert.equal(acrossNewYear, expected)
}

// Run the focused parked-cash interest tests.
export async function runCashInterestTests(): Promise<void> {
    testAnnualRateForYear()
    testSingleDayAndDegenerateGaps()
    testGapDayCount()
    testYearBoundarySplit()
}
