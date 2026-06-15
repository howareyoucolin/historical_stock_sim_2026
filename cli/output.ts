const GRAY = '\u001b[90m'
const RESET = '\u001b[0m'

// Wrap CLI command output in gray ANSI color codes so results stand apart from prompts.
export function formatCliResultOutput(output: string): string {
    if (!output) {
        return output
    }

    return `${GRAY}${output}${RESET}`
}
