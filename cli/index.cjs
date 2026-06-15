#!/usr/bin/env node

const readline = require('node:readline')

const CLI_NAME = 'StockSimulate2026 CLI'
const CLI_PROMPT = 'stocksimulate> '

// Return the shell banner shown when developers enter the CLI realm.
function getBanner() {
    return [
        `${CLI_NAME}`,
        'Welcome to the app realm.',
        'Type `help` to see available commands.',
    ].join('\n')
}

// Return the help text for all supported CLI commands.
function getHelpText() {
    return [
        'Available commands:',
        '  help           Show the command list',
        '  exit           Leave the CLI',
        '  quit           Leave the CLI',
    ].join('\n')
}

// Normalize raw user input into a command token and its arguments.
function parseCommand(input) {
    const parts = input.trim().split(/\s+/).filter(Boolean)

    return {
        command: parts[0] ? parts[0].toLowerCase() : '',
        args: parts.slice(1),
    }
}

// Execute a single CLI command and return the shell response metadata.
function runCommand(input) {
    const { command } = parseCommand(input)

    if (!command) {
        return { output: '', shouldExit: false, clearScreen: false, exitCode: 0 }
    }

    switch (command) {
        case 'help':
            return { output: getHelpText(), shouldExit: false, clearScreen: false, exitCode: 0 }
        case 'exit':
        case 'quit':
            return { output: 'Leaving StockSimulate2026 CLI.', shouldExit: true, clearScreen: false, exitCode: 0 }
        default:
            return {
                output: `Unknown command: ${command}\nType \`help\` to see available commands.`,
                shouldExit: false,
                clearScreen: false,
                exitCode: 1,
            }
    }
}

// Print a command result to stdout and apply any screen-clearing behavior.
function renderResult(result) {
    if (result.clearScreen) {
        console.clear()
    }

    if (result.output) {
        console.log(result.output)
    }
}

// Start the interactive CLI session used by `npm run cli`.
function startInteractiveShell() {
    console.log(getBanner())

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: CLI_PROMPT,
    })

    rl.prompt()

    rl.on('line', (line) => {
        const result = runCommand(line)
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

// Run a single command directly when arguments are passed after `npm run cli --`.
function runSingleCommand(args) {
    const result = runCommand(args.join(' '))
    renderResult(result)
    process.exitCode = result.exitCode
}

if (process.argv.length > 2) {
    runSingleCommand(process.argv.slice(2))
} else {
    startInteractiveShell()
}
