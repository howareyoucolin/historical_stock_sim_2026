import assert from 'node:assert/strict'

import { createRunCommand, getHelpText } from './commands'

// Verify the CLI help text advertises the shared account init command.
function testGetHelpText(): void {
    assert.match(getHelpText(), /account init/)
}

// Verify account init calls the shared session initializer and reports the session file path.
async function testAccountInitCommand(): Promise<void> {
    let initializerWasCalled = false
    const runCommand = createRunCommand({
        initializeDefaultUserAccount: async () => {
            initializerWasCalled = true

            return {
                cash: 0,
                positions: {},
            }
        },
    })

    const result = await runCommand('account init')

    assert.equal(initializerWasCalled, true)
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /user-sessions\/default\.json/)
}

// Verify bad account command arguments return the expected usage guidance.
async function testAccountInitUsage(): Promise<void> {
    const runCommand = createRunCommand()
    const result = await runCommand('account wrong')

    assert.equal(result.exitCode, 1)
    assert.equal(result.output, 'Usage: account init')
}

// Run the focused tests that protect CLI account command wiring.
export async function runCliCommandTests(): Promise<void> {
    testGetHelpText()
    await testAccountInitCommand()
    await testAccountInitUsage()
    console.log('CLI command tests passed.')
}
