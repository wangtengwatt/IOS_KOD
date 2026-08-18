import type { ImageGeneration } from '@shared/types'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { createStore, useStore } from 'zustand'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import blobStorage from '@/storage'
import { deriveAccountKey } from '@/storage/accountKey'
import type { ImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import { authInfoStore } from '@/stores/authInfoStore'
import { enqueueSyncMutation } from '@/sync/outbox'

const log = getLogger('image-generation-store')

interface ImageGenerationUIState {
  currentGeneratingId: string | null
  currentRecordId: string | null
  initialized: boolean
}

interface ImageGenerationUIActions {
  setCurrentGeneratingId: (id: string | null) => void
  setCurrentRecordId: (id: string | null) => void
  setInitialized: (initialized: boolean) => void
}

export const imageGenerationStore = createStore<ImageGenerationUIState & ImageGenerationUIActions>((set) => ({
  currentGeneratingId: null,
  currentRecordId: null,
  initialized: false,

  setCurrentGeneratingId: (id) => set({ currentGeneratingId: id }),
  setCurrentRecordId: (id) => set({ currentRecordId: id }),
  setInitialized: (initialized) => set({ initialized }),
}))

let storage: ImageGenerationStorage | null = null
let _currentImageGenAccountKey: string | null = null

function getAccountKeyForStorage(): string | undefined {
  const email = authInfoStore.getState().loginEmail
  return email ? deriveAccountKey(email) : undefined
}

function getStorage(): ImageGenerationStorage {
  const accountKey = getAccountKeyForStorage() ?? null
  if (accountKey !== _currentImageGenAccountKey || !storage) {
    _currentImageGenAccountKey = accountKey
    storage = platform.getImageGenerationStorage(accountKey ?? undefined)
  }
  return storage
}

/** Reset image generation storage singleton — call when account changes. */
export async function purgeImageGenerationData(accountKey: string): Promise<void> {
  const target =
    _currentImageGenAccountKey === accountKey && storage ? storage : platform.getImageGenerationStorage(accountKey)
  await target.initialize()
  const blobKeys = new Set<string>()
  let cursor = 0
  while (true) {
    const page = await target.getPage(cursor, 100)
    for (const record of page.items) {
      for (const key of [...record.generatedImages, ...record.referenceImages]) {
        if (key.startsWith('picture:image-gen:') || key.startsWith('picture:image-creator-ref:')) blobKeys.add(key)
      }
    }
    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }
  const blobErrors: unknown[] = []
  for (const key of blobKeys) {
    try {
      await blobStorage.delBlob(key)
    } catch (error) {
      blobErrors.push(error)
    }
  }
  await target.deleteDatabase()
  resetImageGenerationStorage()
  imageGenerationStore.setState({ currentGeneratingId: null, currentRecordId: null, initialized: false })
  if (blobErrors.length) throw new AggregateError(blobErrors, 'Failed to delete some image blobs')
}

export function resetImageGenerationStorage() {
  storage = null
  _currentImageGenAccountKey = null
}

async function initializeStore(): Promise<void> {
  const store = imageGenerationStore.getState()
  if (store.initialized) return

  try {
    await getStorage().initialize()
    store.setInitialized(true)
    log.debug('Image generation storage initialized')
  } catch (error) {
    log.error('Failed to initialize image generation storage:', error)
    throw error
  }
}

export const IMAGE_GEN_QUERY_KEY = 'image-generation'
export const IMAGE_GEN_LIST_QUERY_KEY = 'image-generation-list'

export function useImageGenerationHistory(pageSize: number = 20) {
  return useInfiniteQuery({
    queryKey: [IMAGE_GEN_LIST_QUERY_KEY],
    queryFn: async ({ pageParam = 0 }) => {
      const store = imageGenerationStore.getState()
      if (!store.initialized) {
        await initializeStore()
      }
      return getStorage().getPage(pageParam, pageSize)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
    staleTime: 1000 * 60 * 5,
  })
}

export function useImageGenerationRecord(id: string | null) {
  return useQuery({
    queryKey: [IMAGE_GEN_QUERY_KEY, id],
    queryFn: () => {
      if (!id) return null
      return getStorage().getById(id)
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  })
}

export async function createRecord(
  params: Omit<ImageGeneration, 'id' | 'createdAt' | 'status' | 'generatedImages'>
): Promise<ImageGeneration> {
  const store = imageGenerationStore.getState()
  if (!store.initialized) {
    await initializeStore()
  }

  const record: ImageGeneration = {
    id: uuidv4(),
    createdAt: Date.now(),
    status: 'pending',
    generatedImages: [],
    ...params,
  }
  await getStorage().create(record)
  log.debug('Created image generation record:', record.id)
  await enqueueSyncMutation({
    entityType: 'image_generation',
    entityId: record.id,
    payload: record,
    clientUpdatedAt: record.createdAt,
  })
  return record
}

export async function updateRecord(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | null> {
  const updated = await getStorage().update(id, updates)
  if (!updated) {
    log.info('Record not found for update:', id)
  } else {
    await enqueueSyncMutation({ entityType: 'image_generation', entityId: id, payload: updated })
  }
  return updated
}

export async function addGeneratedImage(id: string, storageKey: string): Promise<ImageGeneration | null> {
  const record = await getStorage().getById(id)
  if (!record) {
    log.info('Record not found for adding image:', id)
    return null
  }

  const updated = await getStorage().update(id, {
    generatedImages: [...record.generatedImages, storageKey],
  })
  if (updated) {
    await enqueueSyncMutation({ entityType: 'image_generation', entityId: id, payload: updated })
  }
  return updated
}

export async function deleteRecord(id: string): Promise<void> {
  const store = imageGenerationStore.getState()
  if (!store.initialized) {
    await initializeStore()
  }

  const record = await getStorage().getById(id)
  await getStorage().delete(id)
  log.debug('Deleted image generation record:', id)

  // Best-effort cleanup of blobs. We only delete blobs that are not referenced by any other
  // Image Creator record to avoid breaking DAG/reference workflows.
  if (record) {
    const referencedByOthers = new Set<string>()
    try {
      const total = await getStorage().getTotal()
      let cursor = 0
      const pageSize = 100
      while (cursor < total) {
        const page = await getStorage().getPage(cursor, pageSize)
        for (const r of page.items) {
          if (r.id === id) continue
          for (const k of r.generatedImages) referencedByOthers.add(k)
          for (const k of r.referenceImages) referencedByOthers.add(k)
        }
        if (page.nextCursor === null) break
        cursor = page.nextCursor
      }
    } catch (e) {
      log.error('Failed to scan image generation records for blob cleanup:', e)
    }

    const keys = [...new Set([...record.generatedImages, ...record.referenceImages])]
    for (const key of keys) {
      if (referencedByOthers.has(key)) continue
      // Avoid deleting unrelated blobs.
      if (!key.startsWith('picture:image-gen:') && !key.startsWith('picture:image-creator-ref:')) continue
      try {
        await blobStorage.delBlob(key)
      } catch (e) {
        log.error('Failed to delete blob for record cleanup:', key, e)
      }
    }
  }

  // Clear current record if it's the one being deleted
  if (store.currentRecordId === id) {
    store.setCurrentRecordId(null)
  }
  await enqueueSyncMutation({ entityType: 'image_generation', entityId: id, deleted: true })
}

export function useCurrentGeneratingId() {
  return useStore(imageGenerationStore, (s) => s.currentGeneratingId)
}

export function useCurrentRecordId() {
  return useStore(imageGenerationStore, (s) => s.currentRecordId)
}
