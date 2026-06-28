import { NextResponse } from 'next/server'

import { buildStockListEntries } from '../../../actions/stock/list'

export const runtime = 'nodejs'

// Return every available stock code (every symbol with price history in the database) for the analysis tab.
export async function GET(): Promise<Response> {
    const entries = await buildStockListEntries()

    return NextResponse.json({ stocks: entries.map((entry) => entry.code), entries })
}
