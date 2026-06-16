'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { closeResetModal } from '../../../../store/uiSlice'
import { resetAccount } from './actions'

// Render the reset confirmation modal that gates the destructive account reset. Renders nothing
// while the modal is closed.
export function ResetModal() {
    const dispatch = useAppDispatch()
    const isOpen = useAppSelector((state) => state.ui.isResetModalOpen)
    const isBusy = useAppSelector((state) => state.account.isBusy)

    if (!isOpen) {
        return null
    }

    return (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="resetTitle">
            <div className="modalCard">
                <h3 id="resetTitle">Reset account?</h3>
                <p>This clears all holdings and cash and restores the default starting state. This cannot be undone.</p>
                <div className="modalActions">
                    <button type="button" className="modalCancel" onClick={() => dispatch(closeResetModal())} disabled={isBusy}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modalConfirm"
                        onClick={() => {
                            dispatch(closeResetModal())
                            void dispatch(resetAccount())
                        }}
                        disabled={isBusy}
                    >
                        Reset account
                    </button>
                </div>
            </div>
        </div>
    )
}
