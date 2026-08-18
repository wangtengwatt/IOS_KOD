import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  const auth = {
    accessToken: 'access-token' as string | null,
    loginEmail: 'user@kai.com' as string | null,
  }
  return { values, auth }
})

vi.mock('@/platform', () => ({
  default: {
    getStoreValue: vi.fn(async (key: string) => mocks.values.get(key) ?? null),
    setStoreValue: vi.fn(async (key: string, value: unknown) => {
      mocks.values.set(key, structuredClone(value))
    }),
  },
}))

vi.mock('@/stores/authInfoStore', () => ({
  authInfoStore: {
    getState: () => mocks.auth,
  },
}))

import { commitSyncExchange, enqueueSyncMutation, readSyncState, withRemoteSyncApply } from './outbox'

describe('sync outbox', () => {
  beforeEach(() => {
    mocks.values.clear()
    mocks.auth.accessToken = 'access-token'
    mocks.auth.loginEmail = 'user@kai.com'
  })

  it('coalesces unsent writes and retains the idempotency key', async () => {
    await enqueueSyncMutation({ entityType: 'task', entityId: 'task-1', payload: { name: 'first' } })
    const first = await readSyncState()
    await enqueueSyncMutation({ entityType: 'task', entityId: 'task-1', payload: { name: 'latest' } })
    const latest = await readSyncState()

    expect(latest?.outbox).toHaveLength(1)
    expect(latest?.outbox[0].mutationId).toBe(first?.outbox[0].mutationId)
    expect(latest?.outbox[0].payload).toEqual({ name: 'latest' })
    expect(latest?.outbox[0].baseRevision).toBeNull()
  })

  it('commits acknowledgements and uses the resulting revision as the next base', async () => {
    await enqueueSyncMutation({ entityType: 'skill_settings', entityId: 'current', payload: { enabled: [] } })
    const pending = await readSyncState()
    const mutationId = pending?.outbox[0].mutationId as string

    await commitSyncExchange({
      acknowledgedMutationIds: [mutationId],
      cursor: 9,
      changes: [
        {
          cursor: 9,
          entityType: 'skill_settings',
          entityId: 'current',
          revision: 4,
          clientUpdatedAt: 10,
          serverUpdatedAt: 11,
          sourceDeviceId: 'device',
          deleted: false,
          sensitive: false,
          payload: { enabled: [] },
        },
      ],
    })
    await enqueueSyncMutation({ entityType: 'skill_settings', entityId: 'current', payload: { enabled: ['a'] } })

    const state = await readSyncState()
    expect(state?.cursor).toBe(9)
    expect(state?.outbox).toHaveLength(1)
    expect(state?.outbox[0].baseRevision).toBe(4)
  })

  it('does not echo mutations while applying remote state', async () => {
    await withRemoteSyncApply(() =>
      enqueueSyncMutation({ entityType: 'session', entityId: 'remote', payload: { id: 'remote' } })
    )
    expect((await readSyncState())?.outbox).toHaveLength(0)
  })
})
