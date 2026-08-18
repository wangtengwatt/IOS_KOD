import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface StoreProduct {
  id: string
  displayName: string
  description: string
  displayPrice: string
  type: string
  subscriptionPeriod?: { value: number; unit: string }
}

export interface StoreTransaction {
  transactionId: string
  originalTransactionId: string
  productId: string
  signedTransaction: string
  expirationDate?: number
  revocationDate?: number
}

interface KODStoreKitNativePlugin {
  products(options: { productIds: string[] }): Promise<{ products: StoreProduct[] }>
  purchase(options: {
    productId: string
    appAccountToken: string
  }): Promise<{ status: 'purchased' | 'pending' | 'cancelled'; transaction?: StoreTransaction }>
  restore(): Promise<{ transactions: StoreTransaction[] }>
  unfinished(): Promise<{ transactions: StoreTransaction[] }>
  finish(options: { transactionId: string }): Promise<{ finished: boolean }>
  addListener(
    eventName: 'transactionUpdated',
    listener: (transaction: StoreTransaction) => void
  ): Promise<PluginListenerHandle>
}

export const KODStoreKitNative = registerPlugin<KODStoreKitNativePlugin>('KODStoreKit')
