import type { VideoGeneration } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { createStore, useStore } from 'zustand'
import storage from '@/storage'
import { deriveAccountKey } from '@/storage/accountKey'
import { authInfoStore, useAuthInfoStore } from '@/stores/authInfoStore'
import { enqueueSyncMutation } from '@/sync/outbox'
import { queryClient } from './queryClient'

export const VIDEO_GEN_QUERY_KEY = 'video-generation'
export const VIDEO_GEN_LIST_QUERY_KEY = 'video-generation-list'
const VIDEO_HISTORY_VERSION = 1

interface VideoGenerationUIState {
  currentGeneratingId: string | null
  currentRecordId: string | null
}

export const videoGenerationStore = createStore<VideoGenerationUIState>(() => ({
  currentGeneratingId: null,
  currentRecordId: null,
}))

function accountKey() {
  const email = authInfoStore.getState().loginEmail
  return email ? deriveAccountKey(email) : 'anonymous'
}

function historyKey() {
  return `kod-video-generation:v${VIDEO_HISTORY_VERSION}:${accountKey()}`
}

function readRecords(): VideoGeneration[] {
  try {
    const value = localStorage.getItem(historyKey())
    if (!value) return []
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as VideoGeneration[]) : []
  } catch {
    return []
  }
}

function writeRecords(records: VideoGeneration[]) {
  localStorage.setItem(historyKey(), JSON.stringify(records))
}

/** Apply one server-synchronized record without deleting unrelated local history. */
export function applySyncedVideoRecord(id: string, record: VideoGeneration | null) {
  const remaining = readRecords().filter((item) => item.id !== id)
  writeRecords(record ? [record, ...remaining] : remaining)
}

export function listVideoRecords() {
  return readRecords().sort((left, right) => right.createdAt - left.createdAt)
}

export function getVideoRecord(id: string) {
  return readRecords().find((record) => record.id === id) ?? null
}

export function createVideoRecord(input: Omit<VideoGeneration, 'id' | 'createdAt' | 'status' | 'generatedVideos'>) {
  const record: VideoGeneration = {
    ...input,
    id: uuidv4(),
    createdAt: Date.now(),
    status: 'pending',
    generatedVideos: [],
  }
  writeRecords([record, ...readRecords()])
  void enqueueSyncMutation({
    entityType: 'video_generation',
    entityId: record.id,
    payload: record,
    clientUpdatedAt: record.createdAt,
  })
  return record
}

export function updateVideoRecord(id: string, updates: Partial<VideoGeneration>) {
  let updated: VideoGeneration | null = null
  const records = readRecords().map((record) => {
    if (record.id !== id) return record
    updated = { ...record, ...updates }
    return updated
  })
  if (updated) {
    writeRecords(records)
    void enqueueSyncMutation({ entityType: 'video_generation', entityId: id, payload: updated })
  }
  return updated
}

export async function deleteVideoRecord(id: string) {
  const records = readRecords()
  const record = records.find((item) => item.id === id)
  writeRecords(records.filter((item) => item.id !== id))
  if (record) {
    const keys = [...new Set([...record.referenceImages, ...record.generatedVideos])]
    await Promise.all(
      keys
        .filter((key) => key.startsWith('picture:video-creator-ref:') || key.startsWith('video:video-gen:'))
        .map((key) => storage.delBlob(key).catch(() => undefined))
    )
  }
  if (videoGenerationStore.getState().currentRecordId === id) {
    videoGenerationStore.setState({ currentRecordId: null })
  }
  await enqueueSyncMutation({ entityType: 'video_generation', entityId: id, deleted: true })
  await queryClient.invalidateQueries({ queryKey: [VIDEO_GEN_LIST_QUERY_KEY] })
}

export function useVideoGenerationHistory() {
  const loginEmail = useAuthInfoStore((state) => state.loginEmail)
  return useQuery({
    queryKey: [VIDEO_GEN_LIST_QUERY_KEY, loginEmail || 'anonymous'],
    queryFn: listVideoRecords,
  })
}

export function useVideoGenerationRecord(id: string | null) {
  const loginEmail = useAuthInfoStore((state) => state.loginEmail)
  return useQuery({
    queryKey: [VIDEO_GEN_QUERY_KEY, loginEmail || 'anonymous', id],
    queryFn: () => (id ? getVideoRecord(id) : null),
    enabled: Boolean(id),
  })
}

export function useCurrentGeneratingId() {
  return useStore(videoGenerationStore, (state) => state.currentGeneratingId)
}

export function useCurrentVideoRecordId() {
  return useStore(videoGenerationStore, (state) => state.currentRecordId)
}

export function selectVideoRecord(id: string | null) {
  videoGenerationStore.setState({ currentRecordId: id })
}
