import type { AppThunk } from '../../../../store'
import { setBusy, setStatus, setView, type AccountResponse } from '../../../../store/accountSlice'
import { clearDepositAmount } from '../../../../store/formSlice'
import { closeDepositModal } from '../../../../store/uiSlice'

// Deposit the entered cash amount into the shared account, then refresh the view and close the modal.
export function submitDeposit(): AppThunk<Promise<void>> {
    return async (dispatch, getState) => {
        const parsedAmount = Number(getState().form.depositAmount)

        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            dispatch(setStatus('Deposit amount must be a positive number.'))
            return
        }

        dispatch(setBusy(true))

        try {
            const response = await fetch('/api/account/deposit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: parsedAmount }),
            })
            const payload = (await response.json()) as AccountResponse

            if (!response.ok || payload.error) {
                dispatch(setStatus(payload.error ?? 'Deposit failed.'))
                return
            }

            dispatch(setView(payload.view))
            dispatch(setStatus(payload.message ?? 'Deposit complete.'))
            dispatch(clearDepositAmount())
            dispatch(closeDepositModal())
        } finally {
            dispatch(setBusy(false))
        }
    }
}
