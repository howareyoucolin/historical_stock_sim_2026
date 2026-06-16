'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { setDepositAmount } from '../../../../store/formSlice'
import { closeDepositModal } from '../../../../store/uiSlice'
import { submitDeposit } from './actions'

// Render the deposit-cash modal, reading the amount field and busy flag from the store. Renders
// nothing while the modal is closed.
export function DepositModal() {
    const dispatch = useAppDispatch()
    const isOpen = useAppSelector((state) => state.ui.isDepositModalOpen)
    const depositAmount = useAppSelector((state) => state.form.depositAmount)
    const isBusy = useAppSelector((state) => state.account.isBusy)

    if (!isOpen) {
        return null
    }

    return (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="depositTitle">
            <div className="modalCard">
                <h3 id="depositTitle">Deposit cash</h3>
                <p>Add funds to your account&apos;s available cash.</p>
                <label className="field">
                    <span>Amount</span>
                    <input
                        value={depositAmount}
                        onChange={(event) => dispatch(setDepositAmount(event.target.value))}
                        placeholder="1000"
                        inputMode="decimal"
                        autoFocus
                    />
                </label>
                <div className="modalActions">
                    <button type="button" className="modalCancel" onClick={() => dispatch(closeDepositModal())} disabled={isBusy}>
                        Cancel
                    </button>
                    <button type="button" className="depositConfirm" onClick={() => void dispatch(submitDeposit())} disabled={isBusy}>
                        Deposit
                    </button>
                </div>
            </div>
        </div>
    )
}
