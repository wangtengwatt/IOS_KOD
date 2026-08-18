import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authState: {
    accessToken: 'access-token' as string | null,
    clearTokens: vi.fn(),
  },
  purgeCurrentAccountData: vi.fn(),
  resetMetaStorage: vi.fn(),
  resetTaskSessionStorage: vi.fn(),
  resetImageGenerationStorage: vi.fn(),
  clearKodRelayLocalState: vi.fn(),
  releaseKodRelayKey: vi.fn(),
  deactivate: vi.fn(),
  settingsGetState: vi.fn(),
  settingsSetState: vi.fn(),
  queryClientClear: vi.fn(),
}))

vi.mock('@/hooks/useKodRelay', () => ({ clearKodRelayLocalState: mocks.clearKodRelayLocalState }))
vi.mock('@/packages/kodRelay', () => ({ releaseKodRelayKey: mocks.releaseKodRelayKey }))
vi.mock('@/packages/remote', () => ({ getKodApiOrigin: () => 'http://localhost:8080' }))
vi.mock('@/stores/authInfoStore', () => ({
  authInfoStore: { getState: () => mocks.authState },
  useAuthInfoStore: vi.fn(),
}))
vi.mock('@/stores/chatStore', () => ({
  purgeCurrentAccountData: mocks.purgeCurrentAccountData,
  resetMetaStorage: mocks.resetMetaStorage,
}))
vi.mock('@/stores/imageGenerationStore', () => ({
  resetImageGenerationStorage: mocks.resetImageGenerationStorage,
}))
vi.mock('@/stores/premiumActions', () => ({ deactivate: mocks.deactivate }))
vi.mock('@/stores/queryClient', () => ({ default: { clear: mocks.queryClientClear } }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: mocks.settingsGetState, setState: mocks.settingsSetState },
}))
vi.mock('@/stores/taskSessionStore', () => ({ resetTaskSessionStorage: mocks.resetTaskSessionStorage }))

import { clearKodAuthSession } from './useAuthTokens'

describe('KOD logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authState.accessToken = 'access-token'
    mocks.settingsGetState.mockReturnValue({ licenseActivationMethod: 'login' })
    mocks.settingsSetState.mockImplementation((updater) => updater({ providers: {}, hasExpiredLicense: true }))
    mocks.purgeCurrentAccountData.mockResolvedValue({ sessionCount: 0 })
    mocks.deactivate.mockResolvedValue(undefined)
    mocks.releaseKodRelayKey.mockResolvedValue(undefined)
  })

  it('clears tokens without waiting for blocked IndexedDB cleanup', () => {
    mocks.purgeCurrentAccountData.mockReturnValue(new Promise(() => undefined))

    clearKodAuthSession()

    expect(mocks.authState.clearTokens).toHaveBeenCalledOnce()
    expect(mocks.resetMetaStorage).toHaveBeenCalledOnce()
    expect(mocks.resetTaskSessionStorage).toHaveBeenCalledOnce()
    expect(mocks.resetImageGenerationStorage).toHaveBeenCalledOnce()
    expect(mocks.queryClientClear).toHaveBeenCalledOnce()
  })

  it('still logs out when remote cleanup later fails', async () => {
    mocks.releaseKodRelayKey.mockRejectedValue(new Error('offline'))
    mocks.deactivate.mockRejectedValue(new Error('license server unavailable'))

    clearKodAuthSession()
    await Promise.resolve()

    expect(mocks.authState.clearTokens).toHaveBeenCalledOnce()
    expect(mocks.clearKodRelayLocalState).toHaveBeenCalledOnce()
  })
})
