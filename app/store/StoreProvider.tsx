'use client'

import type { ReactNode } from 'react'
import { Provider } from 'react-redux'

import { store } from './index'

// Client boundary that makes the shared Redux store available to the whole component tree.
export function StoreProvider({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>
}
