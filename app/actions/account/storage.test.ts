import assert from 'node:assert/strict'

import {
    ACCOUNT_STORAGE_KEY,
    createDefaultAccountState,
    initializeAccountStorage,
    normalizeAccountState,
    readAccountStorage,
    type StorageLike,
} from './storage'

class MemoryStorage implements StorageLike {
    private readonly values = new Map<string, string>()

    // Return a stored value for the requested key or null when it is missing.
    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }

    // Persist a string value under the requested key in the test storage shim.
    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }

    // Remove the stored value for the requested key from the test storage shim.
    removeItem(key: string): void {
        this.values.delete(key)
    }
}

// Verify the default account state starts empty and ready for a fresh simulation.
function testCreateDefaultAccountState(): void {
    assert.deepEqual(createDefaultAccountState(), {
        cash: 0,
        positions: {},
    })
}

// Verify bad stored data is normalized into a safe account shape.
function testNormalizeAccountState(): void {
    const account = normalizeAccountState({
        cash: 1500,
        positions: {
            AAPL: [
                {
                    quantity: 10,
                    cost_per_share: 123.45,
                    purchase_date: '2026-06-15',
                },
                {
                    quantity: 'bad',
                    cost_per_share: 1,
                    purchase_date: '2026-06-15',
                },
            ],
            TSLA: 'bad',
        },
    })

    assert.deepEqual(account, {
        cash: 1500,
        positions: {
            AAPL: [
                {
                    quantity: 10,
                    cost_per_share: 123.45,
                    purchase_date: '2026-06-15',
                },
            ],
        },
    })
}

// Verify missing or invalid storage values fall back to the default account state.
function testReadAccountStorage(): void {
    const storage = new MemoryStorage()

    assert.deepEqual(readAccountStorage(storage), createDefaultAccountState())

    storage.setItem(ACCOUNT_STORAGE_KEY, '{not-valid-json')

    assert.deepEqual(readAccountStorage(storage), createDefaultAccountState())
}

// Verify account init removes the previous object and writes a clean default one.
function testInitializeAccountStorage(): void {
    const storage = new MemoryStorage()

    storage.setItem(
        ACCOUNT_STORAGE_KEY,
        JSON.stringify({
            cash: 999,
            positions: {
                MSFT: [
                    {
                        quantity: 3,
                        cost_per_share: 410.25,
                        purchase_date: '2026-01-04',
                    },
                ],
            },
        })
    )

    const initializedAccount = initializeAccountStorage(storage)

    assert.deepEqual(initializedAccount, createDefaultAccountState())
    assert.deepEqual(JSON.parse(storage.getItem(ACCOUNT_STORAGE_KEY) || '{}'), createDefaultAccountState())
}

// Run the focused tests that protect shared account storage normalization behavior.
export async function runAccountStorageTests(): Promise<void> {
    testCreateDefaultAccountState()
    testNormalizeAccountState()
    testReadAccountStorage()
    testInitializeAccountStorage()
    console.log('Account storage tests passed.')
}
