import { AccountPanel } from './components/AccountPanel'
import { StoreProvider } from './store/StoreProvider'

// Render the browser account dashboard inside the shared Redux store boundary.
export default function HomePage() {
    return (
        <StoreProvider>
            <AccountPanel />
        </StoreProvider>
    )
}
