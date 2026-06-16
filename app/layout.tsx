import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
    title: 'StockSimulate 2026',
    description: 'Practice investing with a simulated stock portfolio using real historical market data.',
}

// Render the shared document shell for every app route.
export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    )
}
