'use client'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { setQuantity, setSymbol } from '../../../../store/formSlice'
import { submitTrade } from './actions'

// Render the symbol/quantity inputs and the buy/sell buttons, reading the form fields and busy
// flag from the store and dispatching the trade thunk on submit.
export function TradeBox() {
    const dispatch = useAppDispatch()
    const symbol = useAppSelector((state) => state.form.symbol)
    const quantity = useAppSelector((state) => state.form.quantity)
    const isBusy = useAppSelector((state) => state.account.isBusy)

    return (
        <section className="tradeBox">
            <h2>Trade</h2>
            <div className="tradeFields">
                <label className="field">
                    <span>Symbol</span>
                    <input
                        value={symbol}
                        onChange={(event) => dispatch(setSymbol(event.target.value.toUpperCase()))}
                        autoComplete="off"
                    />
                </label>
                <label className="field">
                    <span>Quantity</span>
                    <input
                        value={quantity}
                        onChange={(event) => dispatch(setQuantity(event.target.value))}
                        inputMode="numeric"
                    />
                </label>
            </div>
            <div className="tradeButtons">
                <button className="buyButton" type="button" onClick={() => void dispatch(submitTrade('buy'))} disabled={isBusy}>
                    Buy
                </button>
                <button className="sellButton" type="button" onClick={() => void dispatch(submitTrade('sell'))} disabled={isBusy}>
                    Sell
                </button>
            </div>
        </section>
    )
}
