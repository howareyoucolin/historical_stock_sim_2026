import type { AppThunk } from '../../../../../store'
import { openStockInfoModal } from '../../../../../store/uiSlice'
import type { AccountStockTableRow } from '../../../../../actions/account/view-model'

// Open the company-info modal for a held stock without disturbing the trade form inputs.
export function showStockInfoFromRow(row: AccountStockTableRow): AppThunk {
    return (dispatch) => {
        dispatch(openStockInfoModal(row.stockCode))
    }
}
