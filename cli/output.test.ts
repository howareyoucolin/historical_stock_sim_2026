import assert from 'node:assert/strict'

import { formatCliResultOutput } from './output'

// Verify CLI command output is wrapped in the gray ANSI escape codes used by the shell renderer.
function testFormatCliResultOutput(): void {
    assert.equal(formatCliResultOutput('Hello'), '\u001b[90mHello\u001b[0m')
}

// Verify empty CLI command output stays empty so blank results do not print escape codes by themselves.
function testFormatCliResultOutputEmpty(): void {
    assert.equal(formatCliResultOutput(''), '')
}

// Run the focused tests that protect CLI output styling behavior.
export async function runCliOutputTests(): Promise<void> {
    testFormatCliResultOutput()
    testFormatCliResultOutputEmpty()
}
