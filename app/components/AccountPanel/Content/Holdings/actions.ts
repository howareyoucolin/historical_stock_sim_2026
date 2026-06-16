import type { AppThunk } from '../../../../store'
import { prefillTrade } from '../../../../store/formSlice'
import type { AccountStockTableRow } from '../../../../actions/account/view-model'

// Prefill the trade form from a held position so it can be quickly sold from the holdings table.
export function prefillTradeFromRow(row: AccountStockTableRow): AppThunk {
    return (dispatch) => {
        dispatch(prefillTrade({ symbol: row.stockCode, quantity: String(row.quantity) }))
    }
}
