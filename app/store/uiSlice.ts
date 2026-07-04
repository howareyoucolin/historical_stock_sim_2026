import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface CalendarPosition {
    top: number
    left: number
}

// The content-area tabs shown above the main column.
export type ContentTab = 'summary' | 'positions' | 'histories' | 'report' | 'analysis'

// Lifecycle of the background refresh poll, surfaced as a subtle status line in the sidebar.
// 'polling' = waiting for the next tick, 'updating' = a refresh is in flight, 'updated'/'nochange'
// reflect whether that refresh changed anything, and 'paused' = auto-stopped after a long idle stretch.
export type PollStatus = 'polling' | 'updating' | 'updated' | 'nochange' | 'paused'

interface UiSliceState {
    isSidebarCollapsed: boolean
    isResetModalOpen: boolean
    isSessionModalOpen: boolean
    isDepositModalOpen: boolean
    isStockInfoModalOpen: boolean
    stockInfoModalCode: string | null
    isCalendarOpen: boolean
    calendarPosition: CalendarPosition | null
    activeTab: ContentTab
    pollStatus: PollStatus
    // Control flag for the polling loop: when true the interval is torn down until the user resumes.
    pollPaused: boolean
}

const initialState: UiSliceState = {
    isSidebarCollapsed: false,
    isResetModalOpen: false,
    isSessionModalOpen: false,
    isDepositModalOpen: false,
    isStockInfoModalOpen: false,
    stockInfoModalCode: null,
    isCalendarOpen: false,
    calendarPosition: null,
    // Default to Positions so real holdings show on load rather than a placeholder tab.
    activeTab: 'positions',
    // Idle/waiting until the first refresh tick fires.
    pollStatus: 'polling',
    pollPaused: false,
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
        openSessionModal(state) {
            state.isSessionModalOpen = true
        },
        closeSessionModal(state) {
            state.isSessionModalOpen = false
        },
        openDepositModal(state) {
            state.isDepositModalOpen = true
        },
        closeDepositModal(state) {
            state.isDepositModalOpen = false
        },
        openStockInfoModal(state, action: PayloadAction<string>) {
            state.stockInfoModalCode = action.payload
            state.isStockInfoModalOpen = true
        },
        closeStockInfoModal(state) {
            state.isStockInfoModalOpen = false
            state.stockInfoModalCode = null
        },
        openCalendar(state, action: PayloadAction<CalendarPosition | null>) {
            state.calendarPosition = action.payload
            state.isCalendarOpen = true
        },
        closeCalendar(state) {
            state.isCalendarOpen = false
        },
        setActiveTab(state, action: PayloadAction<ContentTab>) {
            state.activeTab = action.payload
        },
        setPollStatus(state, action: PayloadAction<PollStatus>) {
            state.pollStatus = action.payload
        },
        setPollPaused(state, action: PayloadAction<boolean>) {
            state.pollPaused = action.payload
        },
    },
})

export const {
    toggleSidebar,
    openResetModal,
    closeResetModal,
    openSessionModal,
    closeSessionModal,
    openDepositModal,
    closeDepositModal,
    openStockInfoModal,
    closeStockInfoModal,
    openCalendar,
    closeCalendar,
    setActiveTab,
    setPollStatus,
    setPollPaused,
} = uiSlice.actions
export default uiSlice.reducer
