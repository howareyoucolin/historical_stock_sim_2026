'use client'

import './style.css'
import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { setQuantity, setSymbol } from '../../../../store/formSlice'
import { money } from '../../../shared/format'
import { fetchUnitPrice, submitTrade } from './actions'

// Wait this long after the last keystroke before looking up a price, so typing a symbol doesn't fire
// a request per character.
const PRICE_LOOKUP_DEBOUNCE_MS = 300

// Render the symbol/quantity inputs and the buy/sell buttons. A live preview below the inputs shows
// the looked-up unit price and, once a quantity is entered, the order total against available cash so
// the user can tell whether a buy is affordable before submitting.
export function TradeBox() {
    const dispatch = useAppDispatch()
    const symbol = useAppSelector((state) => state.form.symbol)
    const quantity = useAppSelector((state) => state.form.quantity)
    const isBusy = useAppSelector((state) => state.account.isBusy)
    const cash = useAppSelector((state) => state.account.view.account.cash)
    const currentDate = useAppSelector((state) => state.account.view.account.date)

    // Transient view-only state: the looked-up unit price for the typed symbol and its loading flag.
    const [unitPrice, setUnitPrice] = useState<number | null>(null)
    const [isLoadingPrice, setIsLoadingPrice] = useState(false)

    const trimmedSymbol = symbol.trim().toUpperCase()
    const parsedQuantity = Number(quantity)
    const hasQuantity = Number.isInteger(parsedQuantity) && parsedQuantity > 0

    // Look up the unit price whenever the symbol (or the simulation date it is priced against) changes,
    // debounced so rapid typing collapses into a single request.
    useEffect(() => {
        if (trimmedSymbol === '') {
            setUnitPrice(null)
            setIsLoadingPrice(false)
            return
        }

        let isActive = true
        setIsLoadingPrice(true)

        const timer = setTimeout(() => {
            void fetchUnitPrice(trimmedSymbol).then((price) => {
                if (isActive) {
                    setUnitPrice(price)
                    setIsLoadingPrice(false)
                }
            })
        }, PRICE_LOOKUP_DEBOUNCE_MS)

        return () => {
            isActive = false
            clearTimeout(timer)
        }
    }, [trimmedSymbol, currentDate])

    const total = unitPrice !== null && hasQuantity ? unitPrice * parsedQuantity : null
    const insufficientCash = total !== null && total > cash

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

            {trimmedSymbol !== '' && (
                <div className="tradePreview">
                    {isLoadingPrice ? (
                        <span className="tradePreviewMuted">Looking up {trimmedSymbol}…</span>
                    ) : unitPrice === null ? (
                        <span className="tradePreviewMuted">No price for {trimmedSymbol}.</span>
                    ) : (
                        <>
                            <div className="tradePreviewRow">
                                <span>Unit price</span>
                                <span>{money(unitPrice)}</span>
                            </div>
                            {hasQuantity && total !== null && (
                                <>
                                    <div className="tradePreviewRow">
                                        <span>Total ({parsedQuantity})</span>
                                        <span className={insufficientCash ? 'neg' : ''}>{money(total)}</span>
                                    </div>
                                    <div className="tradePreviewRow tradePreviewMuted">
                                        <span>Cash available</span>
                                        <span>{money(cash)}</span>
                                    </div>
                                    {insufficientCash && (
                                        <div className="tradePreviewWarn">Not enough cash to buy {parsedQuantity}.</div>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>
            )}

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
