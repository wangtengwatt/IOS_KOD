import platform from '@/platform'
import { deriveAccountKey } from '@/storage/accountKey'
import { authInfoStore } from '@/stores/authInfoStore'
import type { SyncChange, SyncEntityType, SyncLocalState, SyncMutation } from './types'
import { syncEntityKey } from './types'

const DEVICE_ID_KEY = 'kod-sync-device-id:v1'
const STATE_KEY_PREFIX = 'kod-sync-state:v1:'
let stateLock: Promise<unknown> = Promise.resolve()
let remoteApplyDepth = 0

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function currentAccountKey(): string | null {
  const email = authInfoStore.getState().loginEmail
  return email ? deriveAccountKey(email) : null
}

async function getDeviceId(): Promise<string> {
  const existing = await platform.getStoreValue(DEVICE_ID_KEY)
  if (typeof existing === 'string' && existing) return existing
  const created = randomId()
  await platform.setStoreValue(DEVICE_ID_KEY, created)
  return created
}

function stateKey(accountKey: string): string {
  return `${STATE_KEY_PREFIX}${accountKey}`
}

async function readStateForAccount(accountKey: string): Promise<SyncLocalState> {
  const stored = await platform.getStoreValue(stateKey(accountKey))
  if (stored && stored.schemaVersion === 1 && Array.isArray(stored.outbox)) {
    return stored as SyncLocalState
  }
  return {
    schemaVersion: 1,
    deviceId: await getDeviceId(),
    cursor: 0,
    bootstrapComplete: false,
    revisions: {},
    outbox: [],
  }
}

function withStateLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = stateLock.then(operation, operation)
  stateLock = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export async function readSyncState(): Promise<SyncLocalState | null> {
  const accountKey = currentAccountKey()
  if (!accountKey || !authInfoStore.getState().accessToken) return null
  return withStateLock(() => readStateForAccount(accountKey))
}

export async function enqueueSyncMutation(params: {
  entityType: SyncEntityType
  entityId: string
  payload?: unknown
  deleted?: boolean
  sensitive?: boolean
  clientUpdatedAt?: number
}): Promise<void> {
  if (remoteApplyDepth > 0) return
  const accountKey = currentAccountKey()
  if (!accountKey || !authInfoStore.getState().accessToken) return

  await withStateLock(async () => {
    const state = await readStateForAccount(accountKey)
    const key = syncEntityKey(params.entityType, params.entityId)
    const existingIndex = state.outbox.findIndex(
      (item) => item.entityType === params.entityType && item.entityId === params.entityId
    )
    const mutation: SyncMutation = {
      mutationId: existingIndex >= 0 ? state.outbox[existingIndex].mutationId : randomId(),
      deviceId: state.deviceId,
      entityType: params.entityType,
      entityId: params.entityId,
      baseRevision: existingIndex >= 0 ? state.outbox[existingIndex].baseRevision : (state.revisions[key] ?? null),
      clientUpdatedAt: params.clientUpdatedAt ?? Date.now(),
      deleted: params.deleted ?? false,
      sensitive: params.sensitive ?? false,
      ...(params.deleted ? {} : { payload: params.payload }),
    }
    if (existingIndex >= 0) state.outbox[existingIndex] = mutation
    else state.outbox.push(mutation)
    await platform.setStoreValue(stateKey(accountKey), state)
  })

  if (typeof window !== 'undefined') window.dispatchEvent(new Event('kod-sync-dirty'))
}

export async function markSyncBootstrapComplete(): Promise<void> {
  const accountKey = currentAccountKey()
  if (!accountKey) return
  await withStateLock(async () => {
    const state = await readStateForAccount(accountKey)
    state.bootstrapComplete = true
    await platform.setStoreValue(stateKey(accountKey), state)
  })
}

export async function commitSyncExchange(params: {
  acknowledgedMutationIds: string[]
  changes: SyncChange[]
  cursor: number
}): Promise<void> {
  const accountKey = currentAccountKey()
  if (!accountKey) return
  await withStateLock(async () => {
    const state = await readStateForAccount(accountKey)
    const acknowledged = new Set(params.acknowledgedMutationIds)
    state.outbox = state.outbox.filter((item) => !acknowledged.has(item.mutationId))
    for (const change of params.changes) {
      state.revisions[syncEntityKey(change.entityType, change.entityId)] = change.revision
    }
    state.cursor = Math.max(state.cursor, params.cursor)
    await platform.setStoreValue(stateKey(accountKey), state)
  })
}

export function isApplyingRemoteSync(): boolean {
  return remoteApplyDepth > 0
}

export async function withRemoteSyncApply<T>(operation: () => Promise<T>): Promise<T> {
  remoteApplyDepth++
  try {
    return await operation()
  } finally {
    remoteApplyDepth--
  }
}
