export const SYNC_ENTITY_TYPES = [
  'session',
  'task',
  'image_generation',
  'video_generation',
  'model_settings',
  'skill_settings',
] as const

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number]

export interface SyncMutation {
  mutationId: string
  deviceId: string
  entityType: SyncEntityType
  entityId: string
  baseRevision: number | null
  clientUpdatedAt: number
  deleted: boolean
  sensitive: boolean
  payload?: unknown
}

export interface SyncChange {
  cursor: number
  entityType: SyncEntityType
  entityId: string
  revision: number
  clientUpdatedAt: number
  serverUpdatedAt: number
  sourceDeviceId: string
  deleted: boolean
  sensitive: boolean
  payload?: unknown
}

export interface SyncExchangeResponse {
  cursor: number
  acknowledgedMutationIds: string[]
  changes: SyncChange[]
}

export interface SyncLocalState {
  schemaVersion: 1
  deviceId: string
  cursor: number
  bootstrapComplete: boolean
  revisions: Record<string, number>
  outbox: SyncMutation[]
}

export function syncEntityKey(entityType: SyncEntityType, entityId: string): string {
  return `${entityType}:${entityId}`
}
