import fs from 'node:fs/promises'
import path from 'node:path'

import type { SimulationReport } from './build'
import { USER_SESSIONS_DIRECTORY_NAME } from '../account/model'
import { reportFileName } from '../session'

export interface ReportReadDependencies {
    cwd?: () => string
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
}

// Build the repo-relative path to the active session's saved report JSON file.
function reportRelativePath(): string {
    return `${USER_SESSIONS_DIRECTORY_NAME}/${reportFileName()}`
}

// Read the saved simulation report for the active session, returning null when no report exists yet.
export async function readSimulationReport({
    cwd = process.cwd,
    readFile = fs.readFile,
}: ReportReadDependencies = {}): Promise<SimulationReport | null> {
    const filePath = path.join(cwd(), reportRelativePath())

    try {
        return JSON.parse(await readFile(filePath, 'utf8')) as SimulationReport
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null
        }

        if (error instanceof SyntaxError) {
            throw new Error(`Invalid report JSON: ${error.message}`)
        }

        throw error
    }
}
