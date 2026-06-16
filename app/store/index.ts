import { configureStore, type ThunkAction, type Action } from '@reduxjs/toolkit'

import accountReducer from './accountSlice'
import uiReducer from './uiSlice'
import formReducer from './formSlice'

// Compose the app's slices into the single shared store that replaces local component state.
export const store = configureStore({
    reducer: {
        account: accountReducer,
        ui: uiReducer,
        form: formReducer,
    },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

// Return type for the async thunks each component declares in its actions.ts file.
export type AppThunk<ReturnType = void> = ThunkAction<ReturnType, RootState, unknown, Action<string>>
