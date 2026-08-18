import { ofetch } from 'ofetch'
import { z } from 'zod'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { authInfoStore } from '@/stores/authInfoStore'
import {
  CHATBOX_BUILD_CHANNEL,
  CHATBOX_BUILD_PLATFORM,
  KOD_API_ORIGIN,
  NODE_ENV,
  USE_BETA_API,
  USE_BETA_CHATBOX,
  USE_LOCAL_API,
  USE_LOCAL_CHATBOX,
  USE_NEWDB_API,
} from '@/variables'
import * as chatboxaiAPI from '../../shared/request/chatboxai_pool'
import { createAfetch, createAuthenticatedAfetch, uploadFile } from '../../shared/request/request'
import {
  type ChatboxAILicenseDetail,
  type Config,
  type CopilotDetail,
  type ModelProvider,
  type ProviderModelInfo,
  ProviderModelInfoSchema,
  type RemoteConfig,
  type SessionRagConfig,
  type Settings,
} from '../../shared/types'
import { getOS } from './navigator'

const log = getLogger('remote-api')

let _afetch: ReturnType<typeof createAfetch> | null = null
let afetchPromise: Promise<ReturnType<typeof createAfetch>> | null = null

async function initAfetch(): Promise<ReturnType<typeof createAfetch>> {
  if (afetchPromise) return afetchPromise

  afetchPromise = (async () => {
    _afetch = createAfetch({
      type: platform.type,
      platform: await platform.getPlatform(),
      os: getOS(),
      version: await platform.getVersion(),
    })
    return _afetch
  })()

  return afetchPromise
}

async function getAfetch() {
  if (!_afetch) {
    return await initAfetch()
  }
  return _afetch
}

// ========== Authenticated Afetch (带 token 自动刷新) ==========

let _authenticatedAfetch: ReturnType<typeof createAuthenticatedAfetch> | null = null
let authenticatedAfetchPromise: Promise<ReturnType<typeof createAuthenticatedAfetch>> | null = null
let kodSessionRefreshPromise: Promise<{ accessToken: string; refreshToken: string }> | null = null

export async function refreshKodSession(refreshToken?: string) {
  if (!kodSessionRefreshPromise) {
    const token = refreshToken || authInfoStore.getState().refreshToken
    if (!token) {
      authInfoStore.getState().clearTokens()
      throw new Error('No KOD refresh token available')
    }
    kodSessionRefreshPromise = refreshAccessToken({ refreshToken: token })
      .then((tokens) => {
        authInfoStore.getState().setTokens(tokens, { preserveEmail: true })
        return tokens
      })
      .catch((error) => {
        authInfoStore.getState().clearTokens()
        throw error
      })
  }

  const pendingRefresh = kodSessionRefreshPromise
  try {
    return await pendingRefresh
  } finally {
    if (kodSessionRefreshPromise === pendingRefresh) kodSessionRefreshPromise = null
  }
}

async function initAuthenticatedAfetch(): Promise<ReturnType<typeof createAuthenticatedAfetch>> {
  if (authenticatedAfetchPromise) return authenticatedAfetchPromise

  authenticatedAfetchPromise = (async () => {
    _authenticatedAfetch = createAuthenticatedAfetch({
      platformInfo: {
        type: platform.type,
        platform: await platform.getPlatform(),
        os: getOS(),
        version: await platform.getVersion(),
      },
      getTokens: async () => {
        const tokens = authInfoStore.getState().getTokens()
        return tokens
      },
      refreshTokens: async (refreshToken: string) => {
        return refreshKodSession(refreshToken)
      },
      clearTokens: async () => {
        authInfoStore.getState().clearTokens()
      },
    })
    return _authenticatedAfetch
  })()

  return authenticatedAfetchPromise
}

export async function getAuthenticatedAfetch() {
  if (!_authenticatedAfetch) {
    return await initAuthenticatedAfetch()
  }
  return _authenticatedAfetch
}

// ========== API ORIGIN 根据可用性维护 ==========

// KOD: Replaced chatboxai.app origins with KOD's own infrastructure.
// KOD_API_ORIGIN (from @/variables) defaults to https://kod.kai.com, overridable via env var.

export function getAPIOrigin() {
  if (USE_LOCAL_API) {
    return 'http://localhost:8002'
  } else if (USE_BETA_API) {
    return KOD_API_ORIGIN
  } else if (USE_NEWDB_API) {
    return KOD_API_ORIGIN
  } else {
    return chatboxaiAPI.getChatboxAPIOrigin()
  }
}

export function getChatboxOrigin() {
  if (USE_LOCAL_CHATBOX) {
    return 'http://localhost:3002'
  } else if (USE_BETA_CHATBOX) {
    return KOD_API_ORIGIN
  } else {
    return KOD_API_ORIGIN
  }
}

export function getKodApiOrigin() {
  return USE_LOCAL_API || NODE_ENV === 'development' ? 'http://localhost:8080' : KOD_API_ORIGIN
}

export const KOD_AUTH_REQUEST_TIMEOUT_MS = 12_000

function throwReadableKodAuthError(error: unknown): never {
  if (error instanceof Error) {
    const detail = `${error.name} ${error.message}`
    if (/abort|timeout|timed out|failed to fetch|fetch failed|network error/i.test(detail)) {
      throw new Error('登录服务连接超时，请确认本机后端已启动且数据库网络可用后重试')
    }
  }
  throw error
}

export function buildChatboxUrl(path: string) {
  return new URL(path, getChatboxOrigin()).toString()
}

// KOD: Replaced CHATBOX- prefixed headers with KOD- prefixes
const getChatboxHeaders = async () => {
  return {
    'KOD-PLATFORM': await platform.getPlatform(),
    'KOD-PLATFORM-TYPE': platform.type,
    'KOD-CHANNEL': CHATBOX_BUILD_CHANNEL,
    'KOD-VERSION': await platform.getVersion(),
    'KOD-OS': getOS(),
  }
}

// KOD_API_ORIGIN is imported from @/variables, configurable via process.env.KOD_API_ORIGIN

const KodResultSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    code: z.number(),
    message: z.string().optional().default(''),
    data: dataSchema.nullish(),
  })

function unwrapKodResult<T>(result: { code: number; message?: string; data?: T | null }) {
  if (result.code !== 0) {
    throw new Error(result.message || 'Kod API request failed')
  }
  if (result.data == null) {
    throw new Error(result.message || 'Kod API response missing data')
  }
  return result.data
}

export const KOD_ACCOUNT_DELETE_CONFIRMATION = 'DELETE'

export async function deleteKodAccount(params: { accessToken: string; password: string; confirmation?: string }) {
  const json = await ofetch(`${KOD_API_ORIGIN}/api/account`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: {
      password: params.password,
      confirmation: params.confirmation ?? KOD_ACCOUNT_DELETE_CONFIRMATION,
    },
    ignoreResponseError: true,
  })

  const result = KodResultSchema(z.unknown()).parse(json)
  if (result.code !== 0) throw new Error(result.message || 'Kod account deletion failed')
}

export async function loginWithKod(params: {
  email: string
  password: string
  inviteCode?: string
  emailCode?: string
}) {
  let json: unknown
  try {
    json = await ofetch(`${getKodApiOrigin()}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        email: params.email,
        password: params.password,
        ...(params.inviteCode ? { inviteCode: params.inviteCode } : {}),
        ...(params.emailCode ? { emailCode: params.emailCode } : {}),
      },
      ignoreResponseError: true,
      retry: 0,
      timeout: KOD_AUTH_REQUEST_TIMEOUT_MS,
    })
  } catch (error) {
    throwReadableKodAuthError(error)
  }

  const data = unwrapKodResult(
    KodResultSchema(
      z.object({
        token: z.string(),
        refreshToken: z.string().optional(),
        newUser: z.boolean(),
      })
    ).parse(json)
  )

  return {
    accessToken: data.token,
    refreshToken: data.refreshToken || data.token,
    newUser: data.newUser,
  }
}

export async function getKaiIdentityConfig() {
  const client = platform.type === 'mobile' && CHATBOX_BUILD_PLATFORM === 'ios' ? 'ios' : 'desktop'
  const json = await ofetch(`${getKodApiOrigin()}/api/auth/kai/config`, {
    query: { client },
    ignoreResponseError: true,
  })
  return unwrapKodResult(
    KodResultSchema(
      z.object({
        enabled: z.boolean(),
        clientId: z.string(),
        issuer: z.string(),
        authorizationEndpoint: z.string(),
        tokenEndpoint: z.string(),
        redirectUri: z.string(),
        scope: z.string(),
      })
    ).parse(json)
  )
}

export async function loginWithKaiIdentity(accessToken: string) {
  const json = await ofetch(`${getKodApiOrigin()}/api/auth/kai/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { accessToken },
    ignoreResponseError: true,
  })
  const data = unwrapKodResult(
    KodResultSchema(
      z.object({
        token: z.string(),
        refreshToken: z.string().optional(),
        newUser: z.boolean(),
        email: z.string().email(),
      })
    ).parse(json)
  )
  return {
    accessToken: data.token,
    refreshToken: data.refreshToken || data.token,
    newUser: data.newUser,
    email: data.email,
  }
}

/**
 * 发送邮箱验证码。
 */
export async function sendKodEmailCode(email: string) {
  const json = await ofetch(`${getKodApiOrigin()}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email },
    ignoreResponseError: true,
  })
  // send-code 返回 data=null，code=0 即成功
  if (json.code !== 0) {
    throw new Error(json.message || '发送验证码失败')
  }
}

export interface KodRelayStationConfig {
  url: string
  apiKey: string
}

export async function getKodRelayStationConfig(token?: string | null): Promise<KodRelayStationConfig> {
  if (!token) {
    throw new Error('Missing Kod login token')
  }

  const json = await ofetch(`${getKodApiOrigin()}/api/relay-station/config`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    ignoreResponseError: true,
  })

  return unwrapKodResult(
    KodResultSchema(
      z.object({
        url: z.string(),
        apiKey: z.string(),
      })
    ).parse(json)
  )
}

const OpenAICompatibleModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    context_length: z.number().optional(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).optional(),
      })
      .optional(),
    pricing: z
      .object({
        web_search: z.string().optional(),
        internal_reasoning: z.string().optional(),
      })
      .optional(),
    supported_parameters: z.array(z.string()).optional(),
  })
  .passthrough()

const OpenAICompatibleModelsResponseSchema = z
  .object({
    data: z.array(OpenAICompatibleModelSchema),
  })
  .passthrough()

function normalizeRelayBaseUrl(url: string) {
  return url.replace(/\/+$/, '')
}

export async function fetchKodRelayStationModels(config: KodRelayStationConfig): Promise<ProviderModelInfo[]> {
  const json = await ofetch(`${normalizeRelayBaseUrl(config.url)}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  })

  const parsed = OpenAICompatibleModelsResponseSchema.parse(json)
  return parsed.data.map((item) => {
    const capabilities: ProviderModelInfo['capabilities'] = []
    if (item.architecture?.input_modalities?.includes('image')) {
      capabilities.push('vision')
    }
    if (item.pricing?.internal_reasoning && item.pricing.internal_reasoning !== '0') {
      capabilities.push('reasoning')
    }
    if (item.supported_parameters?.some((param) => param === 'tools' || param === 'tool_choice')) {
      capabilities.push('tool_use')
    }
    if (item.pricing?.web_search && item.pricing.web_search !== '0') {
      capabilities.push('web_search')
    }

    // 识别图像生成模型（按 modelId 关键字判断），归入 image 组而非 chat 组
    const modelIdLower = item.id.toLowerCase()
    const isImageModel = /image|dall|flux|stable-diffusion|sdxl|midjourney/.test(modelIdLower)

    return {
      modelId: item.id,
      nickname: item.name,
      type: isImageModel ? ('image' as const) : 'chat',
      contextWindow: item.context_length,
      capabilities,
    }
  })
}

// ========== 各个接口方法 ==========

// KOD: checkNeedUpdate disabled — Kod server does not have the legacy Chatbox
// update-check endpoint. Returns false so the update badge never shows.
export async function checkNeedUpdate(_version: string, _os: string, _config: Config, _settings: Settings) {
  return false
}

// export async function getSponsorAd(): Promise<null | SponsorAd> {
//     type Response = {
//         data: null | SponsorAd
//     }
//     // const res = await ofetch<Response>(`${RELEASE_ORIGIN}/sponsor_ad`, {
//     const res = await ofetch<Response>(`${API_ORIGIN}/sponsor_ad`, {
//         retry: 3,
//     })
//     return res['data'] || null
// }

// export async function listSponsorAboutBanner() {
//     type Response = {
//         data: SponsorAboutBanner[]
//     }
//     // const res = await ofetch<Response>(`${RELEASE_ORIGIN}/sponsor_about_banner`, {
//     const res = await ofetch<Response>(`${API_ORIGIN}/sponsor_ad`, {
//         retry: 3,
//     })
//     return res['data'] || []
// }

// KOD: Copilot APIs disabled — Kod portal does not have these Chatbox marketplace endpoints.
// Functions return empty results silently instead of throwing 500 errors.
// To re-enable when Kod marketplace is ready, remove the early returns.

export async function listCopilotTags(_lang: string) {
  return []
}

export async function listCopilotsByCursor(
  _lang: string,
  _filters?: {
    limit?: number
    cursor?: string
    tag?: string
    search?: string
  }
): Promise<{ data: CopilotDetail[]; next_cursor: string | null }> {
  return { data: [], next_cursor: null }
}

export async function recordCopilotUsage(_params: {
  id: string
  action: 'create_session' | 'create_thread' | 'create_message' | 'use_copilot'
}) {
  // no-op: Kod does not have copilot usage tracking
}

export async function recordCopilotShare(_detail: CopilotDetail) {
  // no-op: Kod does not have copilot sharing
}

export async function getPremiumPrice() {
  type Response = {
    data: {
      price: number
      discount: number
      discountLabel: string
    }
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/premium/price`, {
    retry: 3,
  })
  return res.data
}

export async function getRemoteConfig(config: keyof RemoteConfig) {
  type Response = {
    data: Pick<RemoteConfig, typeof config>
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/remote_config/${config}`, {
    retry: 3,
    headers: await getChatboxHeaders(),
  })
  return res['data']
}

/**
 * In-memory cache for session RAG remote config. The config controls toolset
 * capabilities (rerank availability, rerank model) which the renderer needs every time
 * a tool set is built — once per generation. Hitting the network on each call is
 * wasteful and adds latency to message submission. The remote config changes rarely
 * (capability flag flips, model swaps), so a 10-minute TTL is comfortable.
 *
 * Each cache entry stores the in-flight promise so concurrent callers share a single
 * request. On rejection the entry is evicted so the next caller retries.
 */
type SessionRagConfigCacheEntry = {
  expiresAt: number
  promise: Promise<SessionRagConfig>
}

const SESSION_RAG_CONFIG_CACHE_TTL_MS = 10 * 60 * 1000
const sessionRagConfigCache = new Map<string, SessionRagConfigCacheEntry>()

export async function getSessionRagConfig(params?: { licenseKey?: string }) {
  type Response = {
    data: SessionRagConfig
  }
  const cacheKey = params?.licenseKey ?? ''
  const now = Date.now()
  const cached = sessionRagConfigCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.promise
  }

  const promise = (async () => {
    const headers = await getChatboxHeaders()
    const res = await ofetch<Response>(`${getAPIOrigin()}/api/session_rag/config`, {
      retry: 3,
      headers: {
        ...(params?.licenseKey ? { Authorization: `Bearer ${params.licenseKey}` } : {}),
        ...headers,
      },
    })
    return res.data
  })()

  const entry: SessionRagConfigCacheEntry = {
    expiresAt: now + SESSION_RAG_CONFIG_CACHE_TTL_MS,
    promise,
  }
  sessionRagConfigCache.set(cacheKey, entry)

  // Evict on failure so the next caller retries instead of being stuck with a rejected
  // promise for the entire TTL window.
  promise.catch(() => {
    if (sessionRagConfigCache.get(cacheKey) === entry) {
      sessionRagConfigCache.delete(cacheKey)
    }
  })

  return promise
}

/**
 * Invalidate cached session RAG config. Call this when the license changes or when the
 * caller has reason to believe the remote config has been updated (e.g. user just
 * activated a new license, signed out).
 */
export function invalidateSessionRagConfigCache(licenseKey?: string) {
  if (licenseKey === undefined) {
    sessionRagConfigCache.clear()
    return
  }
  sessionRagConfigCache.delete(licenseKey)
}

export interface DialogConfig {
  markdown: string
  buttons: { label: string; url: string }[]
}

export async function getDialogConfig(params: { uuid: string; language: string; version: string }) {
  type Response = {
    data: null | DialogConfig
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/dialog_config`, {
    method: 'POST',
    retry: 3,
    body: params,
    headers: await getChatboxHeaders(),
  })
  return res['data'] || null
}

export async function getLicenseDetail(params: { licenseKey: string }) {
  type Response = {
    data: ChatboxAILicenseDetail | null
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/license/detail`, {
    retry: 3,
    headers: {
      Authorization: params.licenseKey,
      ...(await getChatboxHeaders()),
    },
  })
  return res['data'] || null
}

export interface LicenseDetailError {
  code: string
  detail: string
  status: number
  title: string
}

export interface LicenseDetailResponse {
  data: ChatboxAILicenseDetail | null
  error?: LicenseDetailError
}

export async function getLicenseDetailRealtime(params: { licenseKey: string }): Promise<LicenseDetailResponse> {
  type Response = {
    data: ChatboxAILicenseDetail | null
    error?: LicenseDetailError
  }
  // 用于捕获错误响应体
  let capturedError: LicenseDetailError | undefined
  try {
    const res = await ofetch<Response>(`${getAPIOrigin()}/api/license/detail/realtime`, {
      retry: 5,
      headers: {
        Authorization: params.licenseKey,
        ...(await getChatboxHeaders()),
      },
      onResponseError({ response }) {
        // 在错误响应时捕获 error 对象
        const body = response._data as { error?: LicenseDetailError } | undefined
        if (body?.error) {
          capturedError = body.error
        }
      },
    })
    return { data: res.data || null, error: res.error }
  } catch (e: unknown) {
    // 如果捕获到了错误响应体，返回它
    if (capturedError) {
      return { data: null, error: capturedError }
    }
    // 重新抛出原始错误
    throw e
  }
}

export async function generateUploadUrl(params: { licenseKey: string; filename: string }) {
  type Response = {
    data: {
      url: string
      filename: string
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/files/generate-upload-url`,
    {
      method: 'POST',
      headers: {
        Authorization: params.licenseKey,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    { parseChatboxRemoteError: true }
  )
  const json: Response = await res.json()
  return json['data']
}

export async function createUserFile<T extends boolean>(params: {
  licenseKey: string
  filename: string
  filetype: string
  returnContent: T
}) {
  type Response = {
    data: {
      uuid: string
      content: T extends true ? string : undefined
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/files/create`,
    {
      method: 'POST',
      headers: {
        Authorization: params.licenseKey,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    { parseChatboxRemoteError: true }
  )
  const json: Response = await res.json()
  return json['data']
}

export async function uploadAndCreateUserFile(licenseKey: string, file: File) {
  const { url, filename } = await generateUploadUrl({
    licenseKey,
    filename: file.name,
  })
  log.debug(`Uploading user file to URL: ${url}`)
  await uploadFile(file, url)
  log.debug(`Uploaded user file: ${file.name}`)
  const result = await createUserFile({
    licenseKey,
    filename,
    filetype: file.type,
    returnContent: true,
  })
  log.debug(`Created user file with UUID: ${result.uuid}`)
  const storageKey = `parseFile-${file.name}_${result.uuid}.${file.type.split('/')[1]}.txt`

  await platform.setStoreBlob(storageKey, result.content)
  return storageKey
}

export async function parseUserLinkPro(params: { licenseKey: string; url: string; abortSignal?: AbortSignal }) {
  type Response = {
    data: {
      uuid: string
      title: string
      content: string
    }
  }
  const { licenseKey, url, abortSignal } = params
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/links/parse`,
    {
      method: 'POST',
      headers: {
        Authorization: licenseKey,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        licenseKey,
        url,
        returnContent: true,
      }),
      signal: abortSignal,
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  const storageKey = `parseUrl-${url}_${json['data']['uuid']}.txt`
  if (json['data']['content']) {
    await platform.setStoreBlob(storageKey, json['data']['content'])
  }
  return {
    key: json['data']['uuid'],
    title: json['data']['title'],
    storageKey,
  }
}

// DISABLED (Sprint 1): was calling cors-proxy.chatboxai.app
// TODO: replace with Kod's own CORS proxy when available
export async function parseUserLinkFree(_params: { url: string }): Promise<{ title: string; text: string }> {
  throw new Error('parseUserLinkFree is disabled. CORS proxy has been removed (was cors-proxy.chatboxai.app).')
}

export async function webBrowsing(params: { licenseKey: string; query: string }) {
  type Response = {
    data: {
      uuid?: string
      query: string
      links: {
        title: string
        url: string
        content: string
      }[]
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/tool/web-search`,
    {
      method: 'POST',
      headers: {
        Authorization: params.licenseKey,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  return json['data']
}

export async function activateLicense(params: { licenseKey: string; instanceName: string }) {
  type Response = {
    data: {
      valid: boolean
      instanceId: string
      error: string
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/license/activate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    {
      parseChatboxRemoteError: true,
      retry: 5,
    }
  )
  const json: Response = await res.json()
  return json['data']
}

export async function deactivateLicense(params: { licenseKey: string; instanceId: string }) {
  const afetch = await getAfetch()
  await afetch(
    `${getAPIOrigin()}/api/license/deactivate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    },
    {
      parseChatboxRemoteError: true,
      retry: 5,
    }
  )
}

export async function validateLicense(params: { licenseKey: string; instanceId: string }) {
  type Response = {
    data: {
      valid: boolean
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/license/validate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    {
      parseChatboxRemoteError: true,
      retry: 5,
    }
  )
  const json: Response = await res.json()
  return json['data']
}

const RemoteModelInfoSchema = z.object({
  modelId: z.string(),
  modelName: z.string(),
  labels: z.array(z.string()).optional(),
  type: z.enum(['chat', 'embedding', 'rerank', 'image']).optional(),
  apiStyle: z.enum(['google', 'openai', 'openai-responses', 'anthropic']).optional(),
  contextWindow: z.number().optional(),
  capabilities: z.array(z.enum(['vision', 'tool_use', 'reasoning'])).optional(),
})

export type RemoteModelInfo = z.infer<typeof RemoteModelInfoSchema>

const ModelManifestResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.object({
    groupName: z.string(),
    models: z.array(RemoteModelInfoSchema),
    imageModels: z.array(RemoteModelInfoSchema).optional().default([]),
  }),
})

export async function getModelManifest(params: { aiProvider: ModelProvider; licenseKey?: string; language?: string }) {
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/model_manifest`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        aiProvider: params.aiProvider,
        licenseKey: params.licenseKey,
        language: params.language,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const { success, data, error } = ModelManifestResponseSchema.safeParse(await res.json())
  if (!success) {
    log.error('getModelManifest error', error)
    throw error
  }
  return data.data
}

export async function reportContent(params: { id: string; type: string; details: string }) {
  const afetch = await getAfetch()
  await afetch(`${getAPIOrigin()}/api/report_content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getChatboxHeaders()),
    },
    body: JSON.stringify(params),
  })
}

const ProviderInfoResponseSchema = z.object({
  success: z.boolean(),
  data: z.record(z.string(), ProviderModelInfoSchema.nullable()),
})

export async function getProviderModelsInfo(params: { modelIds: string[] }) {
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/provider_models_info`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json = ProviderInfoResponseSchema.parse(await res.json())
  return json.data
}

export async function requestLoginTicketId() {
  type Response = {
    data: {
      ticket_id: string
    }
  }
  const afetch = await getAfetch()

  let deviceType: string
  if (platform.type === 'mobile') {
    deviceType = await platform.getPlatform()
  } else if (platform.type === 'desktop') {
    const os = getOS()
    deviceType = os
  } else {
    // web 或其他
    deviceType = platform.type
  }
  const appVersion = await platform.getVersion()
  const deviceName = await platform.getDeviceName()

  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/request_login_ticket`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        device_type: deviceType,
        app_version: appVersion,
        device_name: deviceName,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 3,
    }
  )
  const json: Response = await res.json()
  return json.data.ticket_id
}

export async function sendEmailLoginCode(params: { email: string; lang?: string }) {
  type Response = {
    data: {
      result: string
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/send_email_login_code`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        email: params.email,
        lang: params.lang,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  return json.data.result
}

export async function loginOrSignupWithEmailCode(params: { email: string; code: string }) {
  type Response = {
    data: {
      access_token: string
      refresh_token: string
    }
    success: boolean
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/login_or_signup_with_email_code`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        email: params.email,
        code: params.code,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 1,
    }
  )
  const json: Response = await res.json()
  return {
    accessToken: json.data.access_token,
    refreshToken: json.data.refresh_token,
  }
}

export async function getWebAuthToken(): Promise<string> {
  type Response = {
    data: {
      web_auth_token: string
    }
    success: boolean
  }
  const afetch = await getAuthenticatedAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/web_auth_token/generate`,
    {
      method: 'POST',
      headers: {
        ...(await getChatboxHeaders()),
      },
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  return json.data.web_auth_token
}

export async function checkLoginStatus(ticketId: string) {
  type Response = {
    data: {
      status?: 'success' | 'rejected' | 'pending'
      access_token?: string
      refresh_token?: string
    }
    success: boolean
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/login_status`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({ ticket_id: ticketId }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  const responseStatus = json.data.status
  const accessToken = json.data.access_token || null
  const refreshToken = json.data.refresh_token || null

  let status: 'pending' | 'success' | 'rejected' = 'pending'
  if (responseStatus === 'success' && accessToken && refreshToken) {
    status = 'success'
  } else if (responseStatus === 'rejected') {
    status = 'rejected'
  }

  return {
    status,
    accessToken,
    refreshToken,
  }
}

export async function refreshAccessToken(params: { refreshToken: string }) {
  const json = await ofetch(`${getKodApiOrigin()}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { refreshToken: params.refreshToken },
    ignoreResponseError: true,
    retry: 0,
    timeout: KOD_AUTH_REQUEST_TIMEOUT_MS,
  })
  const data = unwrapKodResult(
    KodResultSchema(
      z.object({
        token: z.string(),
        refreshToken: z.string(),
      })
    ).parse(json)
  )

  return {
    accessToken: data.token,
    refreshToken: data.refreshToken,
  }
}

export async function getUserProfile() {
  type Response = {
    data: {
      email: string
      id: string
      created_at: string
    }
  }
  const afetch = await getAuthenticatedAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/user/profile`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  return json.data
}

export interface UserLicense {
  id: number
  key: string
  status: string
  platform: string
  product_name: string
  payment_type: string
  image_usage: number
  unified_token_usage: number
  unified_token_limit: number
  unified_token_usage_details: Array<{
    type: string
    token_usage: number
    token_limit: number
  }>
  image_limit: number
  next_token_refresh_at: string
  expires_at: string
  created_at: string
  recurring_canceled: boolean
  quota_packs: any[]
}

export async function listLicensesByUser(): Promise<UserLicense[]> {
  type Response = {
    data: UserLicense[]
  }
  const afetch = await getAuthenticatedAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/license/list_by_user`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  return json.data
}

// ========== Image Generation API ==========

const IMAGE_GEN_API_ORIGIN = getAPIOrigin()

export interface ImageCompletionRequest {
  model: string
  prompt: string
  response_format: 'b64_json'
  style?: string
  aspect_ratio?: string
  quantity?: number
  images?: Array<{ image_url: string }>
}

// Zod schemas for runtime validation
// 后端异步生图任务的单个图片 item 状态；不要和客户端本地状态 ImageGeneration.status 混淆。
// 这些状态来自接口，客户端会在 imageGenerationActions.ts 中聚合成一条本地生成记录的整体状态。
const ImageGenerationItemSchema = z.object({
  uuid: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  created_at: z.string(),
  image_url: z.string().optional(),
  generated_at: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
})

const ImageGenerationTaskResponseSchema = z.object({
  // 接口结构预留为数组，但当前产品功能层面不支持一次异步生成多张图。
  // 现阶段后端也写死item 为 1；
  items: z.array(ImageGenerationItemSchema),
  is_finished: z.boolean(),
  task_id: z.string(),
})

export type ImageGenerationItem = z.infer<typeof ImageGenerationItemSchema>
export type ImageGenerationTaskResponse = z.infer<typeof ImageGenerationTaskResponseSchema>

export async function submitImageGeneration(
  params: ImageCompletionRequest,
  licenseKey: string
): Promise<ImageGenerationTaskResponse> {
  const afetch = await getAfetch()
  const res = await afetch(
    `${IMAGE_GEN_API_ORIGIN}/api/images/async_generations`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${licenseKey}`,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json = await res.json()
  return ImageGenerationTaskResponseSchema.parse(json)
}

export async function pollImageTask(
  taskId: string,
  licenseKey: string,
  signal?: AbortSignal
): Promise<ImageGenerationTaskResponse> {
  const afetch = await getAfetch()
  const res = await afetch(
    `${IMAGE_GEN_API_ORIGIN}/api/images/async_generations/${taskId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${licenseKey}`,
        ...(await getChatboxHeaders()),
      },
      signal,
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json = await res.json()
  return ImageGenerationTaskResponseSchema.parse(json)
}

const POLL_INTERVAL_MS = 2000

export async function pollTaskUntilComplete(
  taskId: string,
  licenseKey: string,
  options?: {
    signal?: AbortSignal
    onPoll?: (response: ImageGenerationTaskResponse) => void
  }
): Promise<ImageGenerationTaskResponse> {
  while (true) {
    if (options?.signal?.aborted) {
      throw new DOMException('Polling aborted', 'AbortError')
    }

    const result = await pollImageTask(taskId, licenseKey, options?.signal)
    options?.onPoll?.(result)

    if (result.is_finished) {
      return result
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}
