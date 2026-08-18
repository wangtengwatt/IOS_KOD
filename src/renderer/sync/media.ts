import { getLogger } from '@/lib/utils'
import { getKodApiOrigin } from '@/packages/remote'
import storage from '@/storage'
import type { SyncChange, SyncMutation } from './types'

const log = getLogger('cross-device-media')
const MEDIA_PREFIXES = ['picture:', 'video:']
const MAX_MEDIA_KEYS_PER_EXCHANGE = 200
const MAX_MEDIA_KEYS_PER_SYNC = 2_000
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024

function isMediaStorageKey(value: string): boolean {
  return MEDIA_PREFIXES.some((prefix) => value.startsWith(prefix))
}

export function collectMediaStorageKeys(value: unknown): string[] {
  const keys = new Set<string>()
  const visited = new WeakSet<object>()
  const visit = (current: unknown) => {
    if (typeof current === 'string') {
      if (isMediaStorageKey(current)) keys.add(current)
      return
    }
    if (!current || typeof current !== 'object' || visited.has(current)) return
    visited.add(current)
    if (Array.isArray(current)) {
      for (const entry of current) visit(entry)
      return
    }
    for (const entry of Object.values(current as Record<string, unknown>)) visit(entry)
  }
  visit(value)
  return [...keys].slice(0, MAX_MEDIA_KEYS_PER_SYNC)
}

async function parseApiResult<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { code?: number; message?: string; data?: T } | null
  if (!response.ok || payload?.code !== 0 || payload.data === undefined) {
    throw new Error(payload?.message || `Media sync HTTP ${response.status}`)
  }
  return payload.data
}

async function valueToBlob(key: string, value: string): Promise<Blob> {
  let dataUrl = value
  if (!value.startsWith('data:')) {
    const mediaType = key.startsWith('video:') ? 'video/mp4' : value.startsWith('/9j/') ? 'image/jpeg' : 'image/png'
    dataUrl = `data:${mediaType};base64,${value}`
  }
  const response = await fetch(dataUrl)
  if (!response.ok) throw new Error(`Unable to read local media object ${key}`)
  return response.blob()
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Media object could not be converted to a data URL'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Media object read failed'))
    reader.readAsDataURL(blob)
  })
}

async function inParallel<T>(values: T[], limit: number, operation: (value: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      await operation(values[index])
    }
  })
  await Promise.all(workers)
}

export async function uploadMutationMedia(mutations: SyncMutation[], accessToken: string): Promise<void> {
  const keys = collectMediaStorageKeys(mutations.filter((mutation) => !mutation.deleted).map((mutation) => mutation.payload))
  if (keys.length === 0) return

  const missing: string[] = []
  for (let offset = 0; offset < keys.length; offset += MAX_MEDIA_KEYS_PER_EXCHANGE) {
    const batch = keys.slice(offset, offset + MAX_MEDIA_KEYS_PER_EXCHANGE)
    const missingResponse = await fetch(`${getKodApiOrigin()}/api/media/objects/missing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: batch }),
    })
    const result = await parseApiResult<{ missing: string[] }>(missingResponse)
    missing.push(...result.missing)
  }
  await inParallel(missing, 3, async (key) => {
    const localValue = await storage.getBlob(key)
    if (!localValue) throw new Error(`Local media object is missing: ${key}`)
    const media = await valueToBlob(key, localValue)
    const form = new FormData()
    form.append('key', key)
    form.append('file', media, key.startsWith('video:') ? 'media.mp4' : 'media.png')
    const response = await fetch(`${getKodApiOrigin()}/api/media/objects`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    })
    await parseApiResult(response)
  })
}

export async function downloadChangeMedia(changes: SyncChange[], accessToken: string): Promise<void> {
  const keys = collectMediaStorageKeys(changes.filter((change) => !change.deleted).map((change) => change.payload))
  await inParallel(keys, 3, async (key) => {
    if (await storage.getBlob(key)) return
    const response = await fetch(`${getKodApiOrigin()}/api/media/objects?key=${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) throw new Error(`Media download failed for ${key}: HTTP ${response.status}`)
    const declaredLength = Number(response.headers.get('Content-Length') || 0)
    if (declaredLength > MAX_DOWNLOAD_BYTES) throw new Error(`Media object exceeds the local safety limit: ${key}`)
    const contentType = response.headers.get('Content-Type') || ''
    if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
      throw new Error(`Media object has an unsafe content type: ${key}`)
    }
    const blob = await response.blob()
    if (blob.size > MAX_DOWNLOAD_BYTES) throw new Error(`Media object exceeds the local safety limit: ${key}`)
    await storage.setBlob(key, await blobToDataUrl(blob))
    log.debug('Downloaded cross-device media object', key)
  })
}
