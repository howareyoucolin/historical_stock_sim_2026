'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { openResetModal } from '../../../../store/uiSlice'

// Render the low-emphasis reset button that opens the reset confirmation modal.
export function ResetControl() {
    const dispatch = useAppDispatch()
    const isBusy = useAppSelector((state) => state.account.isBusy)

    return (
        <button className="resetButton" type="button" onClick={() => dispatch(openResetModal())} disabled={isBusy}>
            Reset
        </button>
    )
}
