import type { TaskSession } from '@shared/types'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { createStore, useStore } from 'zustand'
import { combine, persist } from 'zustand/middleware'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { deriveAccountKey } from '@/storage/accountKey'
import type { TaskSessionStorage } from '@/storage/TaskSessionStorage'
import { authInfoStore } from '@/stores/authInfoStore'
import { queryClient } from '@/stores/queryClient'
import { safeStorage } from '@/stores/safeStorage'
import { enqueueSyncMutation } from '@/sync/outbox'

const log = getLogger('task-session-store')

interface TaskSessionUIState {
  currentTaskId: string | null
  initialized: boolean
}

interface TaskSessionUIActions {
  setCurrentTaskId: (id: string | null) => void
  setInitialized: (initialized: boolean) => void
}

export const taskSessionStore = createStore(
  persist(
    combine(
      {
        currentTaskId: null as string | null,
        initialized: false,
      },
      (set) => ({
        setCurrentTaskId: (id: string | null) => set({ currentTaskId: id }),
        setInitialized: (initialized: boolean) => set({ initialized }),
      })
    ),
    {
      name: 'task-session-ui-store',
      version: 0,
      partialize: (state) => ({
        currentTaskId: state.currentTaskId,
      }),
      storage: safeStorage,
    }
  )
)

let storage: TaskSessionStorage | null = null
let _currentTaskAccountKey: string | null = null

function getAccountKeyForStorage(): string | undefined {
  const email = authInfoStore.getState().loginEmail
  return email ? deriveAccountKey(email) : undefined
}

function getStorage(): TaskSessionStorage {
  const accountKey = getAccountKeyForStorage() ?? null
  if (accountKey !== _currentTaskAccountKey || !storage) {
    _currentTaskAccountKey = accountKey
    storage = platform.getTaskSessionStorage(accountKey ?? undefined)
  }
  return storage
}

/** Reset task session storage singleton — call when account changes. */
export async function purgeTaskSessionData(accountKey: string): Promise<void> {
  const target = _currentTaskAccountKey === accountKey && storage ? storage : platform.getTaskSessionStorage(accountKey)
  await target.deleteDatabase()
  resetTaskSessionStorage()
  taskSessionStore.setState({ currentTaskId: null, initialized: false })
  queryClient.removeQueries({ queryKey: [TASK_SESSION_QUERY_KEY] })
  queryClient.removeQueries({ queryKey: [TASK_SESSION_LIST_QUERY_KEY] })
}

export function resetTaskSessionStorage() {
  storage = null
  _currentTaskAccountKey = null
}

async function initializeStore(): Promise<void> {
  const store = taskSessionStore.getState()
  if (store.initialized) return

  try {
    await getStorage().initialize()
    store.setInitialized(true)
    log.debug('Task session storage initialized')
  } catch (error) {
    log.error('Failed to initialize task session storage:', error)
    throw error
  }
}

export const TASK_SESSION_QUERY_KEY = 'task-session'
export const TASK_SESSION_LIST_QUERY_KEY = 'task-session-list'

export function useTaskSessionHistory(pageSize: number = 20) {
  return useInfiniteQuery({
    queryKey: [TASK_SESSION_LIST_QUERY_KEY],
    queryFn: async ({ pageParam = 0 }) => {
      const store = taskSessionStore.getState()
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

export function useTaskSessionRecord(id: string | null) {
  return useQuery({
    queryKey: [TASK_SESSION_QUERY_KEY, id],
    queryFn: async () => {
      if (!id) return null
      const store = taskSessionStore.getState()
      if (!store.initialized) {
        await initializeStore()
      }
      return getStorage().getById(id)
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  })
}

export async function getTaskSession(id: string): Promise<TaskSession | null> {
  const store = taskSessionStore.getState()
  if (!store.initialized) {
    await initializeStore()
  }
  return getStorage().getById(id)
}

export async function createTaskSession(params: Omit<TaskSession, 'id' | 'createdAt'>): Promise<TaskSession> {
  const store = taskSessionStore.getState()
  if (!store.initialized) {
    await initializeStore()
  }

  const record: TaskSession = {
    id: uuidv4(),
    createdAt: Date.now(),
    ...params,
  }
  await getStorage().create(record)
  // Invalidate paginated list cache so sidebar shows the new session
  queryClient.invalidateQueries({ queryKey: [TASK_SESSION_LIST_QUERY_KEY] })
  log.debug('Created task session:', record.id)
  await enqueueSyncMutation({
    entityType: 'task',
    entityId: record.id,
    payload: record,
    clientUpdatedAt: record.createdAt,
  })
  return record
}

export async function updateTaskSession(id: string, updates: Partial<TaskSession>): Promise<TaskSession | null> {
  const store = taskSessionStore.getState()
  if (!store.initialized) {
    await initializeStore()
  }

  const updated = await getStorage().update(id, { ...updates, updatedAt: Date.now() })
  if (!updated) {
    log.info('Task session not found for update:', id)
  } else {
    await enqueueSyncMutation({
      entityType: 'task',
      entityId: id,
      payload: updated,
      clientUpdatedAt: updated.updatedAt ?? Date.now(),
    })
  }
  return updated
}

export async function deleteTaskSession(id: string): Promise<void> {
  const store = taskSessionStore.getState()
  if (!store.initialized) {
    await initializeStore()
  }

  await getStorage().delete(id)
  log.debug('Deleted task session:', id)

  // Clear current task if it's the one being deleted
  if (taskSessionStore.getState().currentTaskId === id) {
    taskSessionStore.getState().setCurrentTaskId(null)
  }
  await enqueueSyncMutation({ entityType: 'task', entityId: id, deleted: true })
}

export function useCurrentTaskId() {
  return useStore(taskSessionStore, (s) => s.currentTaskId)
}
