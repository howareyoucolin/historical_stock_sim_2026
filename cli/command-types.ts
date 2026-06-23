export interface CommandResult {
    output: string
    shouldExit: boolean
    exitCode: number
    // Structured payload for `--json` mode. When set, the runner renders this instead of `output`;
    // when absent, the runner falls back to wrapping `output` as a message/error object.
    data?: unknown
    // True when `output` is a JSON payload (`--json` mode). The renderer prints it verbatim so
    // machine consumers get clean JSON, never wrapped in the human-only ANSI color codes.
    json?: boolean
}
