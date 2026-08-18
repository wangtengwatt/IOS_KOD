import { type FetchOptions, ofetch } from 'ofetch'
import {
  COMPUTE_IMAGE_UPLOAD_MAX_BYTES,
  COMPUTE_IMAGE_UPLOAD_RETRY_BYTES,
  isComputeUploadSizeExceeded,
  prepareComputeImageUpload,
} from '@/packages/computeImageUpload'
import { getKodApiOrigin, refreshKodSession } from '@/packages/remote'
import { authInfoStore } from '@/stores/authInfoStore'

export type ProductType = 'API' | 'GPU'
export type ProductStatus = 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'PAUSED' | 'REJECTED' | 'OFFLINE'

export interface ComputeProduct {
  id: number
  supplierUserId?: number | null
  nodeId?: number | null
  supplierName?: string | null
  productType: ProductType
  name: string
  description: string
  region: string
  status: ProductStatus
  modelId?: string | null
  promptRatePerMillion?: number | null
  completionRatePerMillion?: number | null
  packagePromptTokens?: number | null
  packageCompletionTokens?: number | null
  packagePriceCardHours?: number | null
  upstreamStationId?: number | null
  upstreamKeyId?: number | null
  gpuModel?: string | null
  gpuMemoryGb?: number | null
  gpuCount?: number | null
  pricePerGpuHour?: number | null
  tradeMode?: 'LEGACY_RESERVATION' | 'MARKETPLACE_FIXED' | null
  packageDurationHours?: number | null
  deliveryDeadlineHours?: number | null
  coverImageId?: number | null
  availableFrom?: string | null
  availableTo?: string | null
  deliveryMode?: string | null
  slaDescription?: string | null
  isTest?: number | boolean
  rejectionReason?: string | null
  createTime: string
}

export interface ComputeAccount {
  userId: number
  email: string
  cnyBalance: number
  availableCardHours: number
  frozenCardHours: number
  lifetimeIncome: number
  lifetimeConsumption: number
  rentalIncome: number
  rentalIncomeCnyEquivalent: number
  commissionIncome: number
  pendingCommission: number
  totalIncomeCny: number
  invitedCount: number
  apiSalesIncome: number
  withdrawableCardHours: number
  supplierStatus: string
  identityStatus: string
  isAdmin: boolean
  roles: Array<'BUYER' | 'SUPPLIER' | 'ADMIN'>
  deviceCounts: Record<'PENDING' | 'DEPLOYING' | 'RUNNING' | 'PENDING_ACTION', number>
  gpuAssetCounts: Record<
    'PENDING' | 'REJECTED' | 'RUNNING' | 'PENDING_DELIVERY' | 'ACTIVE_RENTAL' | 'PENDING_ACTION' | 'OFFLINE',
    number
  >
  cardHourCnyRate: number
  cardHourRedeemRate: number
  unitName: string
  currency: string
  unreadNotifications: number
}

export interface ComputeLedgerEntry {
  id: number
  entryType: string
  direction: 'CREDIT' | 'DEBIT'
  amount: number
  availableAfter: number
  frozenAfter: number
  referenceType: string
  referenceId: string
  description: string
  createTime: string
}

export interface ComputeOrder {
  id: number
  orderNo: string
  orderType: string
  productId?: number | null
  productName?: string | null
  coverImageId?: number | null
  cardHours: number
  cnyAmount: number
  status: string
  statusBeforeIncident?: string | null
  incidentReason?: string
  resolutionType?: string | null
  resolutionCardHours?: number | null
  createTime: string
}

export interface ComputeReservation {
  id: number
  orderId: number
  productId: number
  buyerUserId: number
  supplierUserId?: number | null
  buyerEmail?: string
  supplierEmail?: string
  gpuCount: number
  startTime: string
  endTime: string
  unitRateSnapshot: number
  frozenCardHours: number
  settledCardHours: number
  status: string
  statusBeforeIncident?: string | null
  incidentReason?: string
  resolutionType?: string | null
  resolutionCardHours?: number | null
  nodeId?: number | null
  nodeName?: string | null
  nodeStatus?: string | null
  deliveryInfo?: string
  deliveredAt?: string | null
  tradeMode?: 'LEGACY_RESERVATION' | 'MARKETPLACE_FIXED'
  packageDurationHours?: number | null
  buyerPublicKey?: string
  deliveryDeadlineAt?: string | null
  autoConfirmAt?: string | null
  buyerConfirmedAt?: string | null
  disputeReason?: string
  disputeEvidence?: string
  disputedAt?: string | null
  productName: string
  gpuModel: string
  coverImageId?: number | null
  createTime: string
}

export interface ComputeTransfer {
  id: number
  transferNo: string
  senderUserId: number
  recipientUserId: number
  senderEmail: string
  recipientEmail: string
  amount: number
  message: string
  status: string
  reviewReason?: string
  expiresAt: string
  createTime: string
}

export interface ComputeSupplier {
  id?: number
  userId?: number
  email?: string
  displayName?: string
  contact?: string
  description?: string
  status: string
  rejectionReason?: string
  createTime?: string
}

export interface ComputeNotification {
  id: number
  notificationType: string
  title: string
  content: string
  referenceType: string
  referenceId: string
  isRead: number
  createTime: string
  readTime?: string | null
}

export interface ComputeAdminOverview {
  accounts: number
  identitiesPending: number
  suppliersPending: number
  nodesPending: number
  nodesPendingAction: number
  productsPending: number
  transfersPending: number
  reservationsActive: number
  circulatingCardHours: number
  transferReviewThreshold: number
  platformFeeRate: number
}

export interface ComputeWithdrawal {
  id: number
  withdrawalNo: string
  requestId: string
  cardHours: number
  redeemRate: number
  cnyAmount: number
  status: string
  destinationType: 'KOD_CNY_WALLET'
  cardHoursBefore: number
  cardHoursAfter: number
  cnyBalanceBefore: number
  cnyBalanceAfter: number
  completedAt?: string | null
  createTime: string
}

export interface ComputeReferralProfile {
  inviteCode: string
  inviteLink: string
  rewardRate: number
  rewardCap: number
  invitedCount: number
  pendingCommission: number
  paidCommission: number
  bound: boolean
  inviterEmail?: string
  boundAt?: string | null
  canBind: boolean
  bindReason: string
}

export interface ComputeReferralPreview {
  inviteCode: string
  inviterEmail: string
  canBind: boolean
  reason: string
}

export interface ComputeReferralReward {
  id: number
  topupOrderNo: string
  inviteeEmail: string
  rechargeAmount: number
  rewardRate: number
  rewardCap: number
  rewardAmount: number
  status: 'WAITING' | 'PAID' | 'CANCELLED'
  releaseAt: string
  paidAt?: string | null
  cancelReason?: string
  createTime: string
}

export type CardHourAssetType = 'STANDARD' | 'SPECIFIC'
export type CardHourMarketType = 'PRIMARY_SALE' | 'IDLE_TRANSFER' | 'RFQ'

export interface CardHourLot {
  id: number
  assetType: CardHourAssetType
  gpuModel?: string | null
  issuerUserId?: number | null
  nodeId?: number | null
  nodeName?: string | null
  sourceType: string
  sourceRef: string
  originalAmount: number
  remainingAmount: number
  frozenAmount: number
  availableAmount: number
  rateVersion?: string | null
  rateMultiplier?: number | null
  custodyStatus: string
  custodyFeeAccrued: number
  expiresAt?: string | null
  createTime: string
}

export interface CardHourRateRule {
  id: number
  versionNo: string
  gpuModel: string
  multiplier: number
  status: string
  effectiveFrom: string
  notes: string
}

export interface CardHourListing {
  id: number
  listingNo: string
  sellerUserId?: number
  sellerEmail?: string
  sellerName?: string
  identityVerified?: number | boolean
  nodeVerified?: number | boolean
  marketType: CardHourMarketType
  assetType: CardHourAssetType
  gpuModel?: string | null
  nodeId?: number | null
  sourceLotId?: number
  quantity: number
  unitPrice: number
  priceCurrency: 'CNY' | 'CARD_HOUR'
  assetExpiresAt: string
  listingExpiresAt?: string | null
  rateVersion?: string | null
  rateMultiplier?: number | null
  title: string
  description: string
  status: string
  createTime: string
}

export interface CardHourPurchaseQuote {
  id: number
  quoteNo: string
  listingId: number
  buyerUserId: number
  quantity: number
  unitPrice: number
  priceCurrency: 'CNY' | 'CARD_HOUR'
  totalPrice: number
  cnyRate: number
  buyerFee: number
  sellerFee: number
  assetExpiresAt: string
  status: string
  expiresAt: string
}

export interface CardHourTrade {
  id: number
  tradeNo: string
  marketType: CardHourMarketType
  assetType: CardHourAssetType
  gpuModel?: string | null
  quantity: number
  unitPrice: number
  priceCurrency: 'CNY' | 'CARD_HOUR'
  totalPrice: number
  buyerFee: number
  sellerFee: number
  buyerEmail?: string
  sellerEmail?: string
  status: string
  completedAt: string
}

export interface CardHourRfq {
  id: number
  rfqNo: string
  buyerUserId: number
  buyerEmail: string
  assetType: CardHourAssetType
  gpuModel?: string | null
  quantity: number
  minimumExpiresAt: string
  requirements: string
  status: string
  quoteCount: number
  closesAt: string
  createTime: string
}

export interface CardHourRfqQuote {
  id: number
  quoteNo: string
  rfqId: number
  supplierUserId: number
  supplierEmail: string
  supplierName?: string
  listingId: number
  unitPrice: number
  priceCurrency: 'CNY' | 'CARD_HOUR'
  assetExpiresAt: string
  status: string
  expiresAt: string
}

export interface CardHourDeposit {
  id: number
  depositNo: string
  supplierUserId: number
  email?: string
  nodeId: number
  nodeName?: string
  gpuModel: string
  gpuCount: number
  availableFrom: string
  availableTo: string
  expiresAt: string
  gpuHours: number
  rateVersion: string
  rateMultiplier: number
  standardCardHours: number
  status: string
  lotId?: number | null
  rejectionReason?: string
  reviewedAt?: string | null
  createTime: string
}

export interface CardHourRedemption {
  id: number
  redemptionNo: string
  buyerUserId: number
  supplierUserId: number
  buyerEmail: string
  supplierEmail: string
  nodeId: number
  nodeName: string
  gpuModel: string
  gpuCount: number
  startTime: string
  endTime: string
  buyerPublicKey?: string | null
  bookedGpuHours: number
  rateVersion: string
  rateMultiplier: number
  specificHoursFrozen: number
  standardHoursFrozen: number
  actualGpuHours?: number | null
  actualStandardHours?: number | null
  status: string
  deliveryInfo?: string
  deliveryNote?: string
  usageEvidence?: string
  disputeReason?: string
  deliveredAt?: string | null
  stopRemindedAt?: string | null
  usageSubmittedAt?: string | null
  autoConfirmAt?: string | null
  completedAt?: string | null
  createTime: string
}

export interface CardHourMarketStats {
  standardInventory: number
  specificInventory: number
  volume24h: number
  recentTrades: CardHourTrade[]
}

export interface ComputeApiUsage {
  id: number
  requestId: string
  modelId: string
  promptTokens: number
  completionTokens: number
  deductedPromptTokens: number
  deductedCompletionTokens: number
  giftedPromptTokens: number
  giftedCompletionTokens: number
  status: string
  errorMessage?: string
  createTime: string
}

export interface ComputePackageBalance {
  modelId: string
  promptTokensTotal: number
  promptTokensRemaining: number
  completionTokensTotal: number
  completionTokensRemaining: number
  paidCardHours: number
  firstPurchasedAt: string
  lastPurchasedAt: string
}

export interface ComputePackagePurchase {
  id: number
  productId: number
  productName: string
  orderNo: string
  modelId: string
  promptTokensTotal: number
  promptTokensRemaining: number
  completionTokensTotal: number
  completionTokensRemaining: number
  priceCardHours: number
  status: string
  keyStatus: 'ACTIVE' | 'SUSPENDED' | 'EXHAUSTED' | 'CONFIG_REQUIRED'
  accessKeyLast4: string
  suspendedReason?: string
  baseUrl: string
  apiFormat: string
  authenticationHeader: string
  endpoints: string[]
  upstreamStationId?: number | null
  upstreamKeyId?: number | null
  createTime: string
}

export interface ComputePackageCredential {
  purchaseId: number
  modelId: string
  baseUrl: string
  apiKey: string
  apiFormat: string
  authenticationHeader: string
  endpoints: string[]
  keyStatus: string
}

export interface ComputeUpstreamOption {
  stationId: number
  stationUrl: string
  keyId: number
  keyLabel: string
  occupancyStatus: number
}

export interface ComputeSuspendedProxyKey {
  id: number
  userId: number
  email: string
  productId: number
  productName: string
  modelId: string
  keyStatus: string
  accessKeyLast4: string
  suspendedReason: string
  stationUrl?: string
  updateTime: string
}

export interface ComputeIdentity {
  id?: number
  userId?: number
  email?: string
  verificationType?: 'REAL' | 'TEST'
  identityNoMasked?: string
  realName?: string
  identityNo?: string
  status: string
  rejectionReason?: string
  createTime?: string
}

export interface ComputeGpuNode {
  id: number
  supplierUserId: number
  email?: string
  nodeName: string
  region: string
  gpuModel: string
  gpuMemoryGb: number
  gpuCount: number
  cpuDescription: string
  ramGb: number
  storageGb: number
  networkDescription: string
  status: string
  isTest: number | boolean
  reviewReason?: string
  verificationNote?: string
  verificationType?: string
  createTime: string
}

interface KodResult<T> {
  code: number
  message?: string
  data?: T | null
}

export interface CardHourTopUpQuote {
  requiredCardHours: number
  availableCardHours: number
  shortageCardHours: number
  purchaseCardHours: number
  cardHourCnyRate: number
  cnyCost: number
  cnyBalance: number
  cnyShortfall: number
  canAutoTopUp: boolean
}

export class ComputeCenterApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(message)
    this.name = 'ComputeCenterApiError'
  }
}

async function request<T>(path: string, options?: FetchOptions<'json'>, authenticated = true): Promise<T> {
  let token = authInfoStore.getState().accessToken
  if (authenticated && !token) {
    throw new ComputeCenterApiError(401, '请先登录 KOD 账号')
  }

  const execute = (accessToken: string | null) =>
    ofetch<KodResult<T>>(`${getKodApiOrigin()}${path}`, {
      ...options,
      headers: {
        ...(options?.headers || {}),
        ...(authenticated && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ignoreResponseError: true,
    })

  let json = await execute(token)
  if (authenticated && json.code === 401) {
    try {
      const refreshed = await refreshKodSession()
      token = refreshed.accessToken
      json = await execute(token)
    } catch {
      throw new ComputeCenterApiError(401, '登录状态已失效，请重新登录 KOD')
    }
    if (json.code === 401) authInfoStore.getState().clearTokens()
  }
  if (json.code !== 0) {
    throw new ComputeCenterApiError(json.code, json.message || '算力中心请求失败', json.data)
  }
  if (json.data == null) {
    throw new Error(json.message || '算力中心响应缺少数据')
  }
  return json.data
}

export function getComputeConfig() {
  return request<{ cardHourCnyRate: number; cardHourRedeemRate: number; unitName: string; currency: string }>(
    '/api/compute/config',
    undefined,
    false
  )
}

export function listComputeProducts(type?: ProductType) {
  const query = type ? `?type=${type}` : ''
  return request<ComputeProduct[]>(`/api/compute/products${query}`, undefined, false)
}

export function getComputeProductImageUrl(productId: number, imageId: number) {
  return `${getKodApiOrigin()}/api/compute/products/${productId}/images/${imageId}`
}

export function getComputeAccount() {
  return request<ComputeAccount>('/api/compute/account')
}

export function purchaseCardHours(cardHours: number) {
  return request<ComputeAccount>('/api/compute/account/purchase', {
    method: 'POST',
    body: { cardHours },
  })
}

export function listComputeLedger() {
  return request<ComputeLedgerEntry[]>('/api/compute/ledger')
}

export function listComputeOrders() {
  return request<ComputeOrder[]>('/api/compute/orders')
}

export function withdrawComputeCardHours(cardHours: number, requestId = crypto.randomUUID()) {
  return request<ComputeWithdrawal>('/api/compute/withdrawals', {
    method: 'POST',
    body: { cardHours, requestId },
  })
}

export function listComputeWithdrawals() {
  return request<ComputeWithdrawal[]>('/api/compute/withdrawals')
}

export function getComputeReferralProfile() {
  return request<ComputeReferralProfile>('/api/compute/referrals/me')
}

export function previewComputeReferral(inviteCode: string) {
  return request<ComputeReferralPreview>(`/api/compute/referrals/preview?code=${encodeURIComponent(inviteCode)}`)
}

export function bindComputeReferral(inviteCode: string, deviceId: string) {
  return request<ComputeReferralProfile>('/api/compute/referrals/bind', {
    method: 'POST',
    body: { inviteCode, deviceId },
  })
}

export function listComputeReferralRewards() {
  return request<ComputeReferralReward[]>('/api/compute/referrals/rewards')
}

export function listCardHourMarketListings() {
  return request<CardHourListing[]>('/api/compute/card-hours/market/listings', undefined, false)
}

export function getCardHourMarketStats() {
  return request<CardHourMarketStats>('/api/compute/card-hours/market/stats', undefined, false)
}

export function listCardHourRates() {
  return request<CardHourRateRule[]>('/api/compute/card-hours/rates', undefined, false)
}

export function listCardHourLots() {
  return request<CardHourLot[]>('/api/compute/card-hours/lots')
}

export function getCardHourCustody() {
  return request<{ lots: CardHourLot[]; feeEnabled: boolean; accruedFee: number; rule: string }>(
    '/api/compute/card-hours/custody'
  )
}

export function createCardHourListing(input: {
  marketType: 'PRIMARY_SALE' | 'IDLE_TRANSFER'
  assetType: CardHourAssetType
  gpuModel?: string | null
  sourceLotId: number
  quantity: number
  unitPrice: number
  assetExpiresAt: string
  listingExpiresAt?: string | null
  title: string
  description: string
}) {
  return request<CardHourListing>('/api/compute/card-hours/listings', { method: 'POST', body: input })
}

export function listMyCardHourListings() {
  return request<CardHourListing[]>('/api/compute/card-hours/listings/mine')
}

export function cancelCardHourListing(listingId: number) {
  return request<CardHourListing>(`/api/compute/card-hours/listings/${listingId}/cancel`, { method: 'POST' })
}

export function createCardHourPurchaseQuote(listingId: number) {
  return request<CardHourPurchaseQuote>(`/api/compute/card-hours/listings/${listingId}/purchase-quote`, {
    method: 'POST',
  })
}

export function confirmCardHourPurchaseQuote(quoteId: number, autoTopUp = false) {
  return request<CardHourTrade>(
    `/api/compute/card-hours/purchase-quotes/${quoteId}/confirm${autoTopUp ? '?autoTopUp=true' : ''}`,
    { method: 'POST' }
  )
}

export function listCardHourTrades() {
  return request<CardHourTrade[]>('/api/compute/card-hours/trades')
}

export function createCardHourRfq(input: {
  assetType: CardHourAssetType
  gpuModel?: string | null
  quantity: number
  minimumExpiresAt: string
  closesAt?: string | null
  requirements: string
}) {
  return request<CardHourRfq>('/api/compute/card-hours/rfqs', { method: 'POST', body: input })
}

export function listCardHourRfqs() {
  return request<CardHourRfq[]>('/api/compute/card-hours/rfqs')
}

export function quoteCardHourRfq(rfqId: number, sourceLotId: number, unitPrice: number) {
  return request<CardHourRfqQuote>(`/api/compute/card-hours/rfqs/${rfqId}/quotes`, {
    method: 'POST',
    body: { sourceLotId, unitPrice },
  })
}

export function listCardHourRfqQuotes(rfqId: number) {
  return request<CardHourRfqQuote[]>(`/api/compute/card-hours/rfqs/${rfqId}/quotes`)
}

export function acceptCardHourRfqQuote(quoteId: number, autoTopUp = false) {
  return request<CardHourTrade>(
    `/api/compute/card-hours/rfq-quotes/${quoteId}/accept${autoTopUp ? '?autoTopUp=true' : ''}`,
    { method: 'POST' }
  )
}

export function createCardHourDeposit(input: {
  nodeId: number
  availableFrom: string
  availableTo: string
  expiresAt: string
}) {
  return request<CardHourDeposit>('/api/compute/card-hours/deposits', { method: 'POST', body: input })
}

export function listCardHourDeposits() {
  return request<CardHourDeposit[]>('/api/compute/card-hours/deposits')
}

export function createCardHourRedemption(
  input: { nodeId: number; gpuCount: number; startTime: string; endTime: string; buyerPublicKey: string },
  autoTopUp = false
) {
  return request<CardHourRedemption>(`/api/compute/card-hours/redemptions${autoTopUp ? '?autoTopUp=true' : ''}`, {
    method: 'POST',
    body: input,
  })
}

export function listCardHourRedemptions(role: 'buyer' | 'supplier') {
  return request<CardHourRedemption[]>(`/api/compute/card-hours/redemptions?role=${role}`)
}

export function deliverCardHourRedemption(
  id: number,
  input: { sshHost: string; sshPort: number; sshUsername: string; note: string }
) {
  return request<CardHourRedemption>(`/api/compute/card-hours/redemptions/${id}/delivery`, {
    method: 'POST',
    body: input,
  })
}

export function submitCardHourRedemptionUsage(id: number, actualGpuHours: number, evidence: string) {
  return request<CardHourRedemption>(`/api/compute/card-hours/redemptions/${id}/usage`, {
    method: 'POST',
    body: { actualGpuHours, evidence },
  })
}

export function topUpCardHourRedemption(id: number, autoTopUp = false) {
  return request<CardHourRedemption>(
    `/api/compute/card-hours/redemptions/${id}/top-up${autoTopUp ? '?autoTopUp=true' : ''}`,
    { method: 'POST' }
  )
}

export function confirmCardHourRedemption(id: number) {
  return request<CardHourRedemption>(`/api/compute/card-hours/redemptions/${id}/confirm`, { method: 'POST' })
}

export function disputeCardHourRedemption(id: number, reason: string) {
  return request<CardHourRedemption>(`/api/compute/card-hours/redemptions/${id}/dispute`, {
    method: 'POST',
    body: { reason },
  })
}

export function listAdminCardHourDeposits() {
  return request<CardHourDeposit[]>('/api/compute/card-hours/admin/deposits')
}

export function reviewAdminCardHourDeposit(id: number, approved: boolean, reason: string) {
  return request<CardHourDeposit>(`/api/compute/card-hours/admin/deposits/${id}/review`, {
    method: 'POST',
    body: { approved, reason },
  })
}

export function createAdminCardHourRate(input: {
  versionNo: string
  gpuModel: string
  multiplier: number
  notes: string
}) {
  return request<CardHourRateRule>('/api/compute/card-hours/admin/rates', { method: 'POST', body: input })
}

export function resolveAdminCardHourRedemption(id: number, actualGpuHours: number, reason: string) {
  return request<CardHourRedemption>(`/api/compute/card-hours/admin/redemptions/${id}/resolve`, {
    method: 'POST',
    body: { actualGpuHours, reason },
  })
}

export function listAdminCardHourRedemptions() {
  return request<CardHourRedemption[]>('/api/compute/card-hours/admin/redemptions')
}

export function activateComputeApi(productId: number, autoTopUp = false) {
  return request<{ purchased: boolean; productId: number; orderNo: string }>(
    `/api/compute/products/${productId}/purchase${autoTopUp ? '?autoTopUp=true' : ''}`,
    { method: 'POST' }
  )
}

export function listComputePackageBalances() {
  return request<ComputePackageBalance[]>('/api/compute/packages/balances')
}

export function listComputePackagePurchases() {
  return request<ComputePackagePurchase[]>('/api/compute/packages/purchases')
}

export function getComputePackageCredential(purchaseId: number) {
  return request<ComputePackageCredential>(`/api/compute/packages/purchases/${purchaseId}/credential`)
}

export function regenerateComputePackageKey(purchaseId: number) {
  return request<ComputePackageCredential>(`/api/compute/packages/purchases/${purchaseId}/regenerate-key`, {
    method: 'POST',
  })
}

export function authorizeComputePackage(modelId: string) {
  return request<{
    managed: boolean
    allowed: boolean
    modelId: string
    promptTokensRemaining?: number
    completionTokensRemaining?: number
    message: string
  }>(`/api/compute/packages/authorize?modelId=${encodeURIComponent(modelId)}`)
}

export function listComputeActivations() {
  return request<
    Array<{
      id: number
      productId: number
      productName: string
      modelId: string
      promptRatePerMillion: number
      completionRatePerMillion: number
      status: string
      createTime: string
    }>
  >('/api/compute/activations')
}

export function listComputeApiUsage() {
  return request<ComputeApiUsage[]>('/api/compute/usage/api')
}

export function createComputeReservation(
  input: {
    productId: number
    buyerPublicKey: string
  },
  autoTopUp = false
) {
  return request<ComputeReservation>(`/api/compute/reservations${autoTopUp ? '?autoTopUp=true' : ''}`, {
    method: 'POST',
    body: input,
  })
}

export function listComputeReservations(role: 'buyer' | 'supplier' = 'buyer') {
  return request<ComputeReservation[]>(`/api/compute/reservations?role=${role}`)
}

export function cancelComputeReservation(reservationId: number) {
  return request<{ cancelled: boolean; reservationId: number }>(`/api/compute/reservations/${reservationId}/cancel`, {
    method: 'POST',
  })
}

export function deliverComputeReservation(
  reservationId: number,
  input: {
    sshHost: string
    sshPort: number
    sshUsername: string
    actualStart: string
    actualEnd: string
    deliveryNote: string
  }
) {
  return request<ComputeReservation>(`/api/compute/reservations/${reservationId}/delivery`, {
    method: 'POST',
    body: input,
  })
}

export function confirmComputeReservation(reservationId: number) {
  return request<ComputeReservation>(`/api/compute/reservations/${reservationId}/confirm`, { method: 'POST' })
}

export function disputeComputeReservation(reservationId: number, reason: string, evidence: string) {
  return request<ComputeReservation>(`/api/compute/reservations/${reservationId}/dispute`, {
    method: 'POST',
    body: { reason, evidence },
  })
}

export function getComputeSupplier() {
  return request<ComputeSupplier>('/api/compute/supplier/me')
}

export function getComputeIdentity() {
  return request<ComputeIdentity>('/api/compute/identity/me')
}

export function createTestComputeIdentity() {
  return request<ComputeIdentity>('/api/compute/identity/test', { method: 'POST' })
}

export async function submitComputeIdentity(input: { realName: string; identityNo: string; front: File; back: File }) {
  const submit = async (maxBytes: number) => {
    const [front, back] = await Promise.all([
      prepareComputeImageUpload(input.front, maxBytes),
      prepareComputeImageUpload(input.back, maxBytes),
    ])
    const body = new FormData()
    body.append('realName', input.realName)
    body.append('identityNo', input.identityNo)
    body.append('front', front)
    body.append('back', back)
    return request<ComputeIdentity>('/api/compute/identity', { method: 'POST', body })
  }

  try {
    return await submit(COMPUTE_IMAGE_UPLOAD_MAX_BYTES)
  } catch (error) {
    if (!isComputeUploadSizeExceeded(error)) throw error
    return submit(COMPUTE_IMAGE_UPLOAD_RETRY_BYTES)
  }
}

export function listSupplierNodes() {
  return request<ComputeGpuNode[]>('/api/compute/supplier/nodes')
}

export interface ComputeNodeInput {
  nodeName: string
  region: string
  gpuModel: string
  gpuMemoryGb: number
  gpuCount: number
  cpuDescription: string
  ramGb: number
  storageGb: number
  networkDescription: string
  resourceProof: File | null
}

export async function createSupplierNode(input: ComputeNodeInput) {
  const { resourceProof, ...payload } = input
  if (!resourceProof) throw new Error('请上传 GPU 资源证明图片')
  const submit = async (maxBytes: number) => {
    const proof = await prepareComputeImageUpload(resourceProof, maxBytes)
    const body = new FormData()
    body.append('payload', JSON.stringify(payload))
    body.append('resourceProof', proof)
    return request<ComputeGpuNode>('/api/compute/supplier/nodes', { method: 'POST', body })
  }

  try {
    return await submit(COMPUTE_IMAGE_UPLOAD_MAX_BYTES)
  } catch (error) {
    if (!isComputeUploadSizeExceeded(error)) throw error
    return submit(COMPUTE_IMAGE_UPLOAD_RETRY_BYTES)
  }
}

export function applyComputeSupplier(input: { displayName: string; contact: string; description: string }) {
  return request<ComputeSupplier>('/api/compute/supplier/apply', { method: 'POST', body: input })
}

export function listSupplierProducts() {
  return request<ComputeProduct[]>('/api/compute/supplier/products')
}

export interface ComputeProductInput {
  name: string
  description: string
  region: string
  modelId?: string
  promptRatePerMillion?: number
  completionRatePerMillion?: number
  gpuModel?: string
  gpuMemoryGb?: number
  gpuCount?: number
  pricePerGpuHour?: number
  availableFrom?: string
  availableTo?: string
  deliveryMode?: string
  slaDescription?: string
  supplierUserId?: number
  nodeId?: number
  packagePromptTokens?: number
  packageCompletionTokens?: number
  packagePriceCardHours?: number
  packageDurationHours?: number
  deliveryDeadlineHours?: number
  upstreamStationId?: number
  upstreamKeyId?: number
}

export async function createSupplierGpuProduct(input: ComputeProductInput, images: File[] = []) {
  const product = await request<ComputeProduct>('/api/compute/supplier/products', { method: 'POST', body: input })
  for (const image of images) {
    const uploadImage = async (maxBytes: number) => {
      const body = new FormData()
      body.append('image', await prepareComputeImageUpload(image, maxBytes))
      return request<{ imageId: number; productId: number }>(`/api/compute/supplier/products/${product.id}/images`, {
        method: 'POST',
        body,
      })
    }
    try {
      await uploadImage(COMPUTE_IMAGE_UPLOAD_MAX_BYTES)
    } catch (error) {
      if (!isComputeUploadSizeExceeded(error)) throw error
      await uploadImage(COMPUTE_IMAGE_UPLOAD_RETRY_BYTES)
    }
  }
  return product
}

export function createComputeTransfer(
  input: { recipientEmail: string; cardHours: number; message: string },
  autoTopUp = false
) {
  return request<ComputeTransfer>(`/api/compute/transfers${autoTopUp ? '?autoTopUp=true' : ''}`, {
    method: 'POST',
    body: input,
  })
}

export function listComputeTransfers() {
  return request<ComputeTransfer[]>('/api/compute/transfers')
}

export function acceptComputeTransfer(transferId: number) {
  return request<ComputeTransfer>(`/api/compute/transfers/${transferId}/accept`, { method: 'POST' })
}

export function cancelComputeTransfer(transferId: number) {
  return request<{ cancelled: boolean; transferId: number }>(`/api/compute/transfers/${transferId}/cancel`, {
    method: 'POST',
  })
}

export function listComputeNotifications() {
  return request<ComputeNotification[]>('/api/compute/notifications')
}

export function markComputeNotificationRead(notificationId: number) {
  return request<{ read: boolean }>(`/api/compute/notifications/${notificationId}/read`, { method: 'POST' })
}

export function getComputeAdminOverview() {
  return request<ComputeAdminOverview>('/api/compute/admin/overview')
}

export function updateComputeAdminSettings(input: { transferReviewThreshold: number; platformFeeRate: number }) {
  return request<ComputeAdminOverview>('/api/compute/admin/settings', { method: 'POST', body: input })
}

export function listAdminSuppliers() {
  return request<ComputeSupplier[]>('/api/compute/admin/suppliers')
}

export function listAdminIdentities() {
  return request<ComputeIdentity[]>('/api/compute/admin/identities')
}

export function getAdminIdentity(identityId: number) {
  return request<ComputeIdentity>(`/api/compute/admin/identities/${identityId}`)
}

export async function getAdminIdentityDocument(identityId: number, side: 'front' | 'back') {
  const token = authInfoStore.getState().accessToken
  if (!token) throw new Error('请先登录 KOD 账号')
  const response = await fetch(`${getKodApiOrigin()}/api/compute/admin/identities/${identityId}/document/${side}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('证件材料读取失败')
  return response.blob()
}

export function reviewAdminIdentity(identityId: number, approved: boolean, reason = '') {
  return request<ComputeIdentity>(`/api/compute/admin/identities/${identityId}/review`, {
    method: 'POST',
    body: { approved, reason },
  })
}

export function listAdminNodes() {
  return request<ComputeGpuNode[]>('/api/compute/admin/nodes')
}

export async function getAdminNodeProof(nodeId: number) {
  const token = authInfoStore.getState().accessToken
  if (!token) throw new Error('请先登录 KOD 账号')
  const response = await fetch(`${getKodApiOrigin()}/api/compute/admin/nodes/${nodeId}/proof`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('资源证明读取失败')
  return response.blob()
}

export function reviewAdminNode(nodeId: number, approved: boolean, reason = '', verificationNote = '') {
  return request<ComputeGpuNode>(`/api/compute/admin/nodes/${nodeId}/review`, {
    method: 'POST',
    body: { approved, reason, verificationNote },
  })
}

export function updateAdminNodeStatus(nodeId: number, status: string, reason = '') {
  return request<ComputeGpuNode>(`/api/compute/admin/nodes/${nodeId}/status`, {
    method: 'POST',
    body: { status, reason },
  })
}

export function reviewAdminSupplier(supplierId: number, approved: boolean, reason = '') {
  return request<ComputeSupplier>(`/api/compute/admin/suppliers/${supplierId}/review`, {
    method: 'POST',
    body: { approved, reason },
  })
}

export function listAdminProducts() {
  return request<ComputeProduct[]>('/api/compute/admin/products')
}

export function listAdminUpstreams() {
  return request<ComputeUpstreamOption[]>('/api/compute/admin/upstreams')
}

export function configureAdminProductUpstream(productId: number, stationId: number, keyId: number) {
  return request<ComputeProduct>(`/api/compute/admin/products/${productId}/upstream`, {
    method: 'POST',
    body: { stationId, keyId },
  })
}

export function listAdminSuspendedProxyKeys() {
  return request<ComputeSuspendedProxyKey[]>('/api/compute/admin/proxy-keys/suspended')
}

export function repairAdminProxyKey(purchaseId: number, regenerate: boolean) {
  return request<{ purchaseId: number; keyStatus: string; regenerated: boolean }>(
    `/api/compute/admin/proxy-keys/${purchaseId}/repair`,
    { method: 'POST', body: { regenerate } }
  )
}

export function createAdminApiProduct(input: ComputeProductInput) {
  return request<ComputeProduct>('/api/compute/admin/products', { method: 'POST', body: input })
}

export function reviewAdminProduct(productId: number, approved: boolean, reason = '') {
  return request<ComputeProduct>(`/api/compute/admin/products/${productId}/review`, {
    method: 'POST',
    body: { approved, reason },
  })
}

export function listAdminTransfers() {
  return request<ComputeTransfer[]>('/api/compute/admin/transfers')
}

export function listAdminReservations() {
  return request<ComputeReservation[]>('/api/compute/admin/reservations')
}

export function settleAdminReservation(reservationId: number) {
  return request<ComputeReservation>(`/api/compute/admin/reservations/${reservationId}/settle`, {
    method: 'POST',
  })
}

export function resolveAdminReservation(
  reservationId: number,
  input: { resolution: 'FULL_REFUND' | 'ACTUAL_USAGE' | 'FULL_SETTLEMENT'; actualCardHours?: number; reason: string }
) {
  return request<ComputeReservation>(`/api/compute/admin/reservations/${reservationId}/resolve`, {
    method: 'POST',
    body: input,
  })
}

export function reviewAdminTransfer(transferId: number, approved: boolean, reason = '') {
  return request<ComputeTransfer>(`/api/compute/admin/transfers/${transferId}/review`, {
    method: 'POST',
    body: { approved, reason },
  })
}

export function grantAdminCardHours(input: {
  recipientEmail: string
  cardHours: number
  expiresAt?: string | null
  reason: string
}) {
  return request<ComputeAccount>('/api/compute/admin/grants', { method: 'POST', body: input })
}
