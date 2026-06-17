import { NextResponse } from 'next/server'

import { buildStockList } from '../../../actions/stock/list'

export const runtime = 'nodejs'

// Return every available stock code (market-data folders with a built data.json) for the analysis tab.
export async function GET(): Promise<Response> {
    const stocks = await buildStockList()

    return NextResponse.json({ stocks })
}
