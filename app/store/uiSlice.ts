import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface CalendarPosition {
    top: number
    left: number
}

interface UiSliceState {
    isSidebarCollapsed: boolean
    isResetModalOpen: boolean
    isDepositModalOpen: boolean
    isCalendarOpen: boolean
    calendarPosition: CalendarPosition | null
}

const initialState: UiSliceState = {
    isSidebarCollapsed: false,
    isResetModalOpen: false,
    isDepositModalOpen: false,
    isCalendarOpen: false,
    calendarPosition: null,
}

// Track purely presentational toggles (sidebar, modals, calendar popover) so any component can read
// or flip them through the store instead of receiving open/close callbacks as props.
const uiSlice = createSlice({
    name: 'ui',
    initialState,
    reducers: {
        toggleSidebar(state) {
            state.isSidebarCollapsed = !state.isSidebarCollapsed
        },
        openResetModal(state) {
            state.isResetModalOpen = true
        },
        closeResetModal(state) {
            state.isResetModalOpen = false
        },
        openDepositModal(state) {
            state.isDepositModalOpen = true
        },
        closeDepositModal(state) {
            state.isDepositModalOpen = false
        },
        openCalendar(state, action: PayloadAction<CalendarPosition | null>) {
            state.calendarPosition = action.payload
            state.isCalendarOpen = true
        },
        closeCalendar(state) {
            state.isCalendarOpen = false
        },
    },
})

export const {
    toggleSidebar,
    openResetModal,
    closeResetModal,
    openDepositModal,
    closeDepositModal,
    openCalendar,
    closeCalendar,
} = uiSlice.actions
export default uiSlice.reducer
