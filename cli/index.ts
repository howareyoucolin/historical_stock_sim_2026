#!/usr/bin/env tsx

import fs from 'node:fs/promises'
import readline from 'node:readline'

import { getBanner, runCommand } from './commands'
import { formatCliResultOutput } from './output'

const CLI_PROMPT = 'stocksimulate> '

// Print a command result to stdout.
function renderResult(result: { output: string }): void {
    if (result.output) {
        console.log(formatCliResultOutput(result.output))
    }
}

// Start the interactive CLI session used by `npm run cli`.
function startInteractiveShell(): void {
    console.log(getBanner())

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: CLI_PROMPT,
    })

    rl.prompt()

    rl.on('line', async (line) => {
        const result = await runCommand(line)
        renderResult(result)

        if (result.shouldExit) {
            rl.close()
            return
        }

        rl.prompt()
    })

    rl.on('SIGINT', () => {
        console.log('\nUse `exit` or `quit` to leave the CLI.')
        rl.prompt()
    })
}

// Re-quote a shell argument that carries whitespace so re-joining the argv list survives the
// command tokenizer. The shell already stripped the user's quotes, so an arg like
// `--note=buy the dip` would otherwise be split back into separate tokens.
function requoteArg(arg: string): string {
    if (!/\s/.test(arg)) {
        return arg
    }

    // Wrap in double quotes, collapsing any embedded double quotes to single quotes so the wrapping
    // stays unambiguous for the tokenizer.
    return `"${arg.replace(/"/g, "'")}"`
}

// Run a single command directly when arguments are passed after `npm run cli --`.
async function runSingleCommand(args: string[]): Promise<void> {
    const result = await runCommand(args.map(requoteArg).join(' '))
    renderResult(result)
    process.exitCode = result.exitCode
}

// Run every command in a batch file in order, echoing each line. Blank lines and `#` comments are
// skipped. Each line is a raw command (quotes preserved), so notes and --json work as in the shell.
async function runBatchFile(filePath: string): Promise<void> {
    let contents: string

    try {
        contents = await fs.readFile(filePath, 'utf8')
    } catch (error) {
        console.error(formatCliResultOutput(`Batch failed: cannot read ${filePath}: ${(error as Error).message}`))
        process.exitCode = 1
        return
    }

    const lines = contents
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))

    let failures = 0

    for (const line of lines) {
        console.log(formatCliResultOutput(`> ${line}`))
        const result = await runCommand(line)
        renderResult(result)

        if (result.exitCode !== 0) {
            failures += 1
        }
        if (result.shouldExit) {
            break
        }
    }

    process.exitCode = failures > 0 ? 1 : 0
}

const cliArgs = process.argv.slice(2)

if (cliArgs[0] === 'batch') {
    if (!cliArgs[1]) {
        console.error(formatCliResultOutput('Usage: batch <file>'))
        process.exitCode = 1
    } else {
        void runBatchFile(cliArgs[1])
    }
} else if (cliArgs.length > 0) {
    void runSingleCommand(cliArgs)
} else {
    startInteractiveShell()
}
