import {
  type ImageGeneration,
  ImageGenerationSchema,
  type Session,
  SessionMetaRecordSchema,
  SessionSchema,
  type Settings,
  type TaskSession,
  TaskSessionSchema,
  type VideoGeneration,
} from '@shared/types'
import { getLogger } from '@/lib/utils'
import { getKodApiOrigin } from '@/packages/remote'
import platform from '@/platform'
import storage from '@/storage'
import { deriveAccountKey } from '@/storage/accountKey'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { authInfoStore } from '@/stores/authInfoStore'
import { getMetaStorage, listAllSessionsMeta, refreshSessionListCache } from '@/stores/chatStore'
import { IMAGE_GEN_LIST_QUERY_KEY, imageGenerationStore } from '@/stores/imageGenerationStore'
import { queryClient } from '@/stores/queryClient'
import { getSessionMeta } from '@/stores/sessionHelpers'
import { settingsStore } from '@/stores/settingsStore'
import { TASK_SESSION_LIST_QUERY_KEY, taskSessionStore } from '@/stores/taskSessionStore'
import { applySyncedVideoRecord, listVideoRecords, VIDEO_GEN_LIST_QUERY_KEY } from '@/stores/videoGenerationStore'
import {
  commitSyncExchange,
  enqueueSyncMutation,
  markSyncBootstrapComplete,
  readSyncState,
  withRemoteSyncApply,
} from './outbox'
import { downloadChangeMedia, uploadMutationMedia } from './media'
import { getModelSyncPayload } from './payloads'
import { SYNC_ENTITY_TYPES, type SyncChange, type SyncExchangeResponse } from './types'

const log = getLogger('cross-device-sync')
const SYNC_INTERVAL_MS = 15_000
const MAX_MUTATIONS_PER_EXCHANGE = 200
let initialized = false
let syncPromise: Promise<void> | null = null
let scheduleTimer: number | undefined

function accountKey(): string | null {
  const email = authInfoStore.getState().loginEmail
  return email ? deriveAccountKey(email) : null
}

function sessionUpdatedAt(session: Session, createdAt: number): number {
  const messageTimes = session.messages.map((message) => message.timestamp ?? 0)
  const threadTimes = (session.threads ?? []).flatMap((thread) => [
    thread.createdAt,
    ...thread.messages.map((message) => message.timestamp ?? 0),
  ])
  return Math.max(createdAt, ...messageTimes, ...threadTimes)
}

async function enqueueBootstrapSnapshot(): Promise<void> {
  const state = await readSyncState()
  if (!state || state.bootstrapComplete) return

  const metas = await listAllSessionsMeta()
  for (const meta of metas) {
    const session = await storage.getItem<Session | null>(StorageKeyGenerator.session(meta.id), null)
    if (!session) continue
    await enqueueSyncMutation({
      entityType: 'session',
      entityId: session.id,
      payload: { session, meta },
      clientUpdatedAt: sessionUpdatedAt(session, meta.createdAt),
    })
  }

  const key = accountKey()
  if (!key) return
  const taskStorage = platform.getTaskSessionStorage(key)
  const imageStorage = platform.getImageGenerationStorage(key)
  await Promise.all([taskStorage.initialize(), imageStorage.initialize()])

  for (let cursor = 0; ; ) {
    const page = await taskStorage.getPage(cursor, 100)
    for (const task of page.items) {
      await enqueueSyncMutation({
        entityType: 'task',
        entityId: task.id,
        payload: task,
        clientUpdatedAt: task.updatedAt ?? task.createdAt,
      })
    }
    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }

  for (let cursor = 0; ; ) {
    const page = await imageStorage.getPage(cursor, 100)
    for (const image of page.items) {
      await enqueueSyncMutation({
        entityType: 'image_generation',
        entityId: image.id,
        payload: image,
        clientUpdatedAt: image.createdAt,
      })
    }
    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }

  for (const video of listVideoRecords()) {
    await enqueueSyncMutation({
      entityType: 'video_generation',
      entityId: video.id,
      payload: video,
      clientUpdatedAt: video.createdAt,
    })
  }

  const settings = settingsStore.getState()
  await enqueueSyncMutation({
    entityType: 'model_settings',
    entityId: 'current',
    payload: getModelSyncPayload(settings),
    sensitive: true,
  })
  await enqueueSyncMutation({
    entityType: 'skill_settings',
    entityId: 'current',
    payload: settings.skills,
  })
  await markSyncBootstrapComplete()
}

function parseExchangeResponse(value: unknown): SyncExchangeResponse {
  if (!value || typeof value !== 'object') throw new Error('同步服务返回空响应')
  const wrapper = value as { code?: number; message?: string; data?: unknown }
  if (wrapper.code !== 0) throw new Error(wrapper.message || '同步服务请求失败')
  const data = wrapper.data as SyncExchangeResponse | undefined
  if (!data || !Number.isSafeInteger(data.cursor) || !Array.isArray(data.changes)) {
    throw new Error('同步服务响应格式无效')
  }
  const allowedTypes = new Set<string>(SYNC_ENTITY_TYPES)
  for (const change of data.changes) {
    if (!allowedTypes.has(change.entityType) || typeof change.entityId !== 'string') {
      throw new Error('同步服务返回未知实体类型')
    }
  }
  return {
    cursor: data.cursor,
    changes: data.changes,
    acknowledgedMutationIds: Array.isArray(data.acknowledgedMutationIds) ? data.acknowledgedMutationIds : [],
  }
}

async function applySessionChange(change: SyncChange): Promise<void> {
  const metaStorage = await getMetaStorage()
  if (change.deleted) {
    await storage.removeItem(StorageKeyGenerator.session(change.entityId))
    await metaStorage.delete(change.entityId)
    return
  }
  const payload = change.payload as { session?: unknown; meta?: unknown }
  const parsedSession = SessionSchema.parse(payload?.session)
  const session = { ...parsedSession, id: change.entityId }
  const suppliedMeta = SessionMetaRecordSchema.safeParse(payload?.meta)
  const existingMeta = await metaStorage.getById(change.entityId)
  const meta = suppliedMeta.success
    ? { ...suppliedMeta.data, id: change.entityId }
    : {
        ...getSessionMeta(session),
        sortOrder: existingMeta?.sortOrder ?? change.clientUpdatedAt,
        createdAt: existingMeta?.createdAt ?? change.clientUpdatedAt,
      }
  await storage.setItemNow(StorageKeyGenerator.session(change.entityId), session)
  if (existingMeta) await metaStorage.update(change.entityId, meta)
  else await metaStorage.create(meta)
}

async function applyTaskChange(change: SyncChange, key: string): Promise<void> {
  const target = platform.getTaskSessionStorage(key)
  await target.initialize()
  if (change.deleted) {
    await target.delete(change.entityId)
    return
  }
  const record = { ...TaskSessionSchema.parse(change.payload), id: change.entityId }
  if (await target.getById(record.id)) await target.update(record.id, record)
  else await target.create(record)
}

async function applyImageChange(change: SyncChange, key: string): Promise<void> {
  const target = platform.getImageGenerationStorage(key)
  await target.initialize()
  if (change.deleted) {
    await target.delete(change.entityId)
    return
  }
  const record = { ...ImageGenerationSchema.parse(change.payload), id: change.entityId }
  if (await target.getById(record.id)) await target.update(record.id, record)
  else await target.create(record)
}

async function applyChange(change: SyncChange, key: string): Promise<void> {
  switch (change.entityType) {
    case 'session':
      await applySessionChange(change)
      break
    case 'task':
      await applyTaskChange(change, key)
      break
    case 'image_generation':
      await applyImageChange(change, key)
      break
    case 'video_generation':
      applySyncedVideoRecord(
        change.entityId,
        change.deleted ? null : ({ ...(change.payload as VideoGeneration), id: change.entityId } as VideoGeneration)
      )
      break
    case 'model_settings':
      if (!change.deleted && change.payload && typeof change.payload === 'object') {
        settingsStore.setState(change.payload as Partial<Settings>)
      }
      break
    case 'skill_settings':
      if (!change.deleted && change.payload && typeof change.payload === 'object') {
        settingsStore.setState({ skills: change.payload as Settings['skills'] })
      }
      break
  }
}

async function invalidateSyncedQueries(): Promise<void> {
  await Promise.all([
    refreshSessionListCache(),
    queryClient.invalidateQueries({ queryKey: [TASK_SESSION_LIST_QUERY_KEY] }),
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] }),
    queryClient.invalidateQueries({ queryKey: [VIDEO_GEN_LIST_QUERY_KEY] }),
  ])
  taskSessionStore.setState({ initialized: true })
  imageGenerationStore.setState({ initialized: true })
}

export async function syncNow(): Promise<void> {
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    if (!navigator.onLine) return
    const tokens = authInfoStore.getState().getTokens()
    const key = accountKey()
    if (!tokens || !key) return

    await enqueueBootstrapSnapshot()
    const state = await readSyncState()
    if (!state) return
    const mutations = state.outbox.slice(0, MAX_MUTATIONS_PER_EXCHANGE)
    await uploadMutationMedia(mutations, tokens.accessToken)
    const response = await fetch(`${getKodApiOrigin()}/api/sync/exchange`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: state.deviceId,
        cursor: state.cursor,
        mutations,
      }),
    })
    if (!response.ok) throw new Error(`同步服务 HTTP ${response.status}`)
    const exchange = parseExchangeResponse(await response.json())
    await downloadChangeMedia(exchange.changes, tokens.accessToken)
    await withRemoteSyncApply(async () => {
      for (const change of exchange.changes) await applyChange(change, key)
    })
    await commitSyncExchange(exchange)
    if (exchange.changes.length > 0) await invalidateSyncedQueries()

    const remaining = await readSyncState()
    if (remaining?.outbox.length) scheduleSync(250)
  })()
    .catch((error) => {
      log.warn('Cross-device synchronization failed; changes remain in the local outbox', error)
    })
    .finally(() => {
      syncPromise = null
    })
  return syncPromise
}

export function scheduleSync(delay = 1_500): void {
  if (scheduleTimer !== undefined) window.clearTimeout(scheduleTimer)
  scheduleTimer = window.setTimeout(() => {
    scheduleTimer = undefined
    void syncNow()
  }, delay)
}

export function initCrossDeviceSync(): void {
  if (initialized) return
  initialized = true
  window.addEventListener('online', () => scheduleSync(0))
  window.addEventListener('kod-sync-dirty', () => scheduleSync())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(0)
  })
  authInfoStore.subscribe(
    (state) => state.accessToken,
    (token, previousToken) => {
      if (token && token !== previousToken) scheduleSync(0)
    }
  )
  window.setInterval(() => {
    if (document.visibilityState === 'visible') scheduleSync(0)
  }, SYNC_INTERVAL_MS)
  scheduleSync(0)
}

export async function queueSessionSync(session: Session, meta?: unknown): Promise<void> {
  const storedMeta = meta ?? (await (await getMetaStorage()).getById(session.id))
  await enqueueSyncMutation({
    entityType: 'session',
    entityId: session.id,
    payload: { session, meta: storedMeta },
    clientUpdatedAt: Date.now(),
  })
}

export function queueTaskSync(task: TaskSession): Promise<void> {
  return enqueueSyncMutation({
    entityType: 'task',
    entityId: task.id,
    payload: task,
    clientUpdatedAt: task.updatedAt ?? task.createdAt,
  })
}

export function queueImageSync(image: ImageGeneration): Promise<void> {
  return enqueueSyncMutation({
    entityType: 'image_generation',
    entityId: image.id,
    payload: image,
    clientUpdatedAt: Date.now(),
  })
}
