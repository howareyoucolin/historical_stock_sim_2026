import type { ContentTab } from '../../../store/uiSlice'

// The query parameter that persists the active content tab across reloads (e.g. ?tab=analysis).
const TAB_PARAM = 'tab'
const VALID_TABS: ContentTab[] = ['summary', 'positions', 'histories', 'analysis', 'report']

// Narrow an arbitrary string to a known ContentTab.
export function isContentTab(value: string | null): value is ContentTab {
    return value !== null && (VALID_TABS as string[]).includes(value)
}

// Read the active tab from the URL query, or null when absent/invalid.
export function readTabFromUrl(): ContentTab | null {
    if (typeof window === 'undefined') {
        return null
    }

    const value = new URL(window.location.href).searchParams.get(TAB_PARAM)

    return isContentTab(value) ? value : null
}

// Persist the active tab in the URL without adding a history entry or triggering a navigation, so a
// refresh restores the same tab and the URL is shareable.
export function writeTabToUrl(tab: ContentTab): void {
    if (typeof window === 'undefined') {
        return
    }

    const url = new URL(window.location.href)
    url.searchParams.set(TAB_PARAM, tab)
    window.history.replaceState(null, '', url)
}
