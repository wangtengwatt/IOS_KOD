import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearKodRelayLocalState: vi.fn(),
  deleteKodAccount: vi.fn(),
  closeSuanbaoRepository: vi.fn(),
  getSuanbaoRepository: vi.fn(),
  suanbaoRuntimeClose: vi.fn(),
  getAuthState: vi.fn(),
  purgeCurrentAccountData: vi.fn(),
  resetMetaStorage: vi.fn(),
  purgeImageGenerationData: vi.fn(),
  resetImageGenerationStorage: vi.fn(),
  queryClientClear: vi.fn(),
  settingsSetState: vi.fn(),
  purgeTaskSessionData: vi.fn(),
  resetTaskSessionStorage: vi.fn(),
  purgeSuanbaoPreferences: vi.fn(),
  repositoryDeleteDatabase: vi.fn(),
  clearTokens: vi.fn(),
}))

vi.mock('@/hooks/useKodRelay', () => ({ clearKodRelayLocalState: mocks.clearKodRelayLocalState }))
vi.mock('@/packages/remote', () => ({ deleteKodAccount: mocks.deleteKodAccount }))
vi.mock('@/packages/suanbao/repositories/createSuanbaoRepository', () => ({
  getSuanbaoRepository: mocks.getSuanbaoRepository,
  closeSuanbaoRepository: mocks.closeSuanbaoRepository,
}))
vi.mock('@/packages/suanbao/runtime', () => ({ suanbaoRuntime: { close: mocks.suanbaoRuntimeClose } }))
vi.mock('@/stores/authInfoStore', () => ({ authInfoStore: { getState: mocks.getAuthState } }))
vi.mock('@/stores/chatStore', () => ({
  purgeCurrentAccountData: mocks.purgeCurrentAccountData,
  resetMetaStorage: mocks.resetMetaStorage,
}))
vi.mock('@/stores/imageGenerationStore', () => ({
  purgeImageGenerationData: mocks.purgeImageGenerationData,
  resetImageGenerationStorage: mocks.resetImageGenerationStorage,
}))
vi.mock('@/stores/queryClient', () => ({ default: { clear: mocks.queryClientClear } }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { setState: mocks.settingsSetState } }))
vi.mock('@/stores/taskSessionStore', () => ({
  purgeTaskSessionData: mocks.purgeTaskSessionData,
  resetTaskSessionStorage: mocks.resetTaskSessionStorage,
}))
vi.mock('@/components/suanbao/suanbaoStore', () => ({
  purgeSuanbaoPreferences: mocks.purgeSuanbaoPreferences,
}))

import { AccountDeletedWithCleanupError, canDeleteAccount, deleteCurrentKodAccount } from './accountDeletion'

const expectNoLocalCleanup = () => {
  expect(mocks.purgeCurrentAccountData).not.toHaveBeenCalled()
  expect(mocks.purgeTaskSessionData).not.toHaveBeenCalled()
  expect(mocks.purgeImageGenerationData).not.toHaveBeenCalled()
  expect(mocks.repositoryDeleteDatabase).not.toHaveBeenCalled()
  expect(mocks.purgeSuanbaoPreferences).not.toHaveBeenCalled()
  expect(mocks.clearTokens).not.toHaveBeenCalled()
}

describe('account deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAuthState.mockReturnValue({
      accessToken: 'access-token',
      loginEmail: 'user@example.com',
      clearTokens: mocks.clearTokens,
    })
    mocks.getSuanbaoRepository.mockReturnValue({ deleteDatabase: mocks.repositoryDeleteDatabase })
    mocks.deleteKodAccount.mockResolvedValue(undefined)
    mocks.purgeCurrentAccountData.mockResolvedValue({ sessionCount: 1 })
    mocks.purgeTaskSessionData.mockResolvedValue(undefined)
    mocks.purgeImageGenerationData.mockResolvedValue(undefined)
    mocks.suanbaoRuntimeClose.mockResolvedValue(undefined)
    mocks.closeSuanbaoRepository.mockResolvedValue(undefined)
    mocks.repositoryDeleteDatabase.mockResolvedValue(undefined)
  })

  it('supports KAI-only accounts while requiring exact DELETE text and acknowledgement', () => {
    expect(canDeleteAccount('', 'DELETE', true)).toBe(true)
    expect(canDeleteAccount('password', 'delete', true)).toBe(false)
    expect(canDeleteAccount('password', 'DELETE', false)).toBe(false)
    expect(canDeleteAccount('password', 'DELETE', true)).toBe(true)
  })

  it('never starts local cleanup when server deletion fails', async () => {
    mocks.deleteKodAccount.mockRejectedValue(new Error('Incorrect password'))

    await expect(deleteCurrentKodAccount('bad-password')).rejects.toThrow('Incorrect password')

    expectNoLocalCleanup()
  })

  it('clears local account data and tokens after server deletion succeeds', async () => {
    await expect(deleteCurrentKodAccount('password')).resolves.toBeUndefined()

    expect(mocks.deleteKodAccount).toHaveBeenCalledWith({
      accessToken: 'access-token',
      password: 'password',
      confirmation: 'DELETE',
    })
    expect(mocks.purgeCurrentAccountData).toHaveBeenCalledOnce()
    expect(mocks.purgeTaskSessionData).toHaveBeenCalledOnce()
    expect(mocks.purgeImageGenerationData).toHaveBeenCalledOnce()
    expect(mocks.closeSuanbaoRepository).toHaveBeenCalledOnce()
    expect(mocks.repositoryDeleteDatabase).toHaveBeenCalledOnce()
    expect(mocks.clearTokens).toHaveBeenCalledOnce()
  })

  it('still clears tokens and reports cleanup status when local cleanup partially fails', async () => {
    const cleanupFailure = new Error('task cleanup failed')
    mocks.purgeTaskSessionData.mockRejectedValue(cleanupFailure)

    const result = deleteCurrentKodAccount('password')
    await expect(result).rejects.toBeInstanceOf(AccountDeletedWithCleanupError)
    await expect(result).rejects.toMatchObject({
      serverAccountDeleted: true,
      cleanupErrors: [cleanupFailure],
    })
    expect(mocks.purgeImageGenerationData).toHaveBeenCalledOnce()
    expect(mocks.repositoryDeleteDatabase).toHaveBeenCalledOnce()
    expect(mocks.clearTokens).toHaveBeenCalledOnce()
  })
})
