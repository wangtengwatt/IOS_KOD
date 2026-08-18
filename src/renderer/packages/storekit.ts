import { Capacitor } from '@capacitor/core'
import { getKodApiOrigin, refreshKodSession } from '@/packages/remote'
import { KODStoreKitNative, type StoreProduct, type StoreTransaction } from '@/platform/mobile_plugins/storekit'
import { authInfoStore } from '@/stores/authInfoStore'

export interface StoreAccount {
  appAccountToken: string
  subscriptionProductIds: string[]
  consumableProductIds: string[]
  creditBalance: number
  activeSubscriptions: Array<Record<string, unknown>>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = authInfoStore.getState().accessToken
  if (!token) throw new Error('请先登录 KAI 账户')

  const execute = async (accessToken: string) => {
    const response = await fetch(`${getKodApiOrigin()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    const json = (await response.json()) as { code?: number; message?: string; data?: T }
    return { response, json }
  }

  let { response, json } = await execute(token)
  if (response.status === 401 || json.code === 401) {
    try {
      const refreshed = await refreshKodSession()
      token = refreshed.accessToken
      ;({ response, json } = await execute(token))
    } catch {
      throw new Error('登录状态已失效，请重新登录 KOD')
    }
    if (response.status === 401 || json.code === 401) authInfoStore.getState().clearTokens()
  }
  if (!response.ok || json.code !== 0 || json.data == null) {
    throw new Error(json.message || `StoreKit 服务 HTTP ${response.status}`)
  }
  return json.data
}

function requireIOS() {
  if (Capacitor.getPlatform() !== 'ios') throw new Error('StoreKit 2 仅在 iOS 客户端可用')
}

async function reconcile(transaction: StoreTransaction) {
  const result = await request<Record<string, unknown>>('/api/storekit/transactions', {
    method: 'POST',
    body: JSON.stringify({ signedTransaction: transaction.signedTransaction }),
  })
  await KODStoreKitNative.finish({ transactionId: transaction.transactionId })
  return result
}

export async function listStoreProducts(): Promise<{ account: StoreAccount; products: StoreProduct[] }> {
  requireIOS()
  const account = await request<StoreAccount>('/api/storekit/account')
  const productIds = [...account.subscriptionProductIds, ...account.consumableProductIds]
  const { products } = await KODStoreKitNative.products({ productIds })
  return { account, products }
}

export async function purchaseStoreProduct(productId: string) {
  requireIOS()
  const account = await request<StoreAccount>('/api/storekit/account')
  const purchase = await KODStoreKitNative.purchase({ productId, appAccountToken: account.appAccountToken })
  if (purchase.status !== 'purchased' || !purchase.transaction) return purchase
  return { ...purchase, reconciliation: await reconcile(purchase.transaction) }
}

export async function restoreStorePurchases() {
  requireIOS()
  const { transactions } = await KODStoreKitNative.restore()
  const results = []
  for (const transaction of transactions) results.push(await reconcile(transaction))
  return results
}

export async function syncUnfinishedStoreTransactions() {
  if (Capacitor.getPlatform() !== 'ios' || !authInfoStore.getState().accessToken) return []
  const { transactions } = await KODStoreKitNative.unfinished()
  const results = []
  for (const transaction of transactions) results.push(await reconcile(transaction))
  return results
}

let initialized = false
export function initStoreKitReconciliation() {
  if (initialized || Capacitor.getPlatform() !== 'ios') return
  initialized = true
  void syncUnfinishedStoreTransactions().catch(console.error)
  void KODStoreKitNative.addListener('transactionUpdated', (transaction) => {
    if (authInfoStore.getState().accessToken) void reconcile(transaction).catch(console.error)
  })
  authInfoStore.subscribe((state, previous) => {
    if (state.accessToken && state.accessToken !== previous.accessToken) {
      void syncUnfinishedStoreTransactions().catch(console.error)
    }
  })
}
