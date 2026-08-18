import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  products: vi.fn(),
  purchase: vi.fn(),
  restore: vi.fn(),
  unfinished: vi.fn(),
  finish: vi.fn(),
  addListener: vi.fn(),
}))
const auth = vi.hoisted(() => ({ accessToken: 'kod-token' as string | null }))
const refreshKodSession = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' } }))
vi.mock('@/platform/mobile_plugins/storekit', () => ({ KODStoreKitNative: native }))
vi.mock('@/packages/remote', () => ({
  getKodApiOrigin: () => 'https://kod.kai.com',
  refreshKodSession,
}))
vi.mock('@/stores/authInfoStore', () => ({
  authInfoStore: { getState: () => ({ ...auth, clearTokens: vi.fn() }), subscribe: vi.fn() },
}))

import { listStoreProducts, purchaseStoreProduct } from './storekit'

const account = {
  appAccountToken: '6bfa4f9d-9aa4-4a16-87f3-5b8560637fd6',
  subscriptionProductIds: ['com.kai.kod.pro.monthly'],
  consumableProductIds: ['com.kai.kod.credits.100'],
  creditBalance: 0,
  activeSubscriptions: [],
}

const transaction = {
  transactionId: '1000000001',
  originalTransactionId: '1000000001',
  productId: 'com.kai.kod.credits.100',
  signedTransaction: 'header.payload.signature',
}

describe('StoreKit reconciliation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.values(native).forEach((mock) => mock.mockReset())
    refreshKodSession.mockReset()
    auth.accessToken = 'kod-token'
  })

  it('loads only the server allowlisted product identifiers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: account }) }))
    native.products.mockResolvedValue({ products: [] })

    await listStoreProducts()

    expect(native.products).toHaveBeenCalledWith({
      productIds: ['com.kai.kod.pro.monthly', 'com.kai.kod.credits.100'],
    })
  })

  it('finishes a transaction only after the backend accepts the Apple JWS', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: account }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { accepted: true, transactionId: transaction.transactionId } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    native.purchase.mockResolvedValue({ status: 'purchased', transaction })
    native.finish.mockResolvedValue({ finished: true })

    await purchaseStoreProduct(transaction.productId)

    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ signedTransaction: transaction.signedTransaction })
    )
    expect(native.finish).toHaveBeenCalledWith({ transactionId: transaction.transactionId })
  })

  it('leaves a transaction unfinished when server verification fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: account }) })
        .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ code: 400, message: 'invalid JWS' }) })
    )
    native.purchase.mockResolvedValue({ status: 'purchased', transaction })

    await expect(purchaseStoreProduct(transaction.productId)).rejects.toThrow('invalid JWS')
    expect(native.finish).not.toHaveBeenCalled()
  })

  it('refreshes an expired KOD session before loading App Store products', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 401, message: 'expired' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, data: account }) })
    vi.stubGlobal('fetch', fetchMock)
    refreshKodSession.mockResolvedValue({ accessToken: 'refreshed-access', refreshToken: 'refreshed-refresh' })
    native.products.mockResolvedValue({ products: [] })

    await listStoreProducts()

    expect(refreshKodSession).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer refreshed-access' })
  })
})
