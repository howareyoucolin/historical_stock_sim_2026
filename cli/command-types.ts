export interface CommandResult {
    output: string
    shouldExit: boolean
    exitCode: number
    // Structured payload for `--json` mode. When set, the runner renders this instead of `output`;
    // when absent, the runner falls back to wrapping `output` as a message/error object.
    data?: unknown
}
