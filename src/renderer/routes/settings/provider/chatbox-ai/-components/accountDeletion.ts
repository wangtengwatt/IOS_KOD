import { ModelProviderEnum } from '@shared/types'
import { purgeSuanbaoPreferences } from '@/components/suanbao/suanbaoStore'
import { clearKodRelayLocalState } from '@/hooks/useKodRelay'
import { deleteKodAccount } from '@/packages/remote'
import { closeSuanbaoRepository, getSuanbaoRepository } from '@/packages/suanbao/repositories/createSuanbaoRepository'
import { suanbaoRuntime } from '@/packages/suanbao/runtime'
import { deriveAccountKey } from '@/storage/accountKey'
import { authInfoStore } from '@/stores/authInfoStore'
import { purgeCurrentAccountData, resetMetaStorage } from '@/stores/chatStore'
import { purgeImageGenerationData, resetImageGenerationStorage } from '@/stores/imageGenerationStore'
import queryClient from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import { purgeTaskSessionData, resetTaskSessionStorage } from '@/stores/taskSessionStore'

export const ACCOUNT_DELETE_CONFIRMATION = 'DELETE'

export function canDeleteAccount(_password: string, confirmation: string, acknowledged: boolean): boolean {
  // Password accounts are re-authenticated by the server. KAI-only accounts
  // have no user-known KOD password, so confirmation must also work without it.
  return confirmation === ACCOUNT_DELETE_CONFIRMATION && acknowledged
}

export class AccountDeletedWithCleanupError extends Error {
  readonly serverAccountDeleted = true
  constructor(readonly cleanupErrors: unknown[]) {
    super(
      'Account deleted, but some local data could not be removed. You have been signed out; restart the app or remove the remaining data manually.'
    )
    this.name = 'AccountDeletedWithCleanupError'
  }
}

function clearAccountCaches() {
  clearKodRelayLocalState()
  settingsStore.setState((state) => ({
    hasExpiredLicense: false,
    licenseKey: state.licenseActivationMethod === 'login' ? undefined : state.licenseKey,
    licenseActivationMethod: state.licenseActivationMethod === 'login' ? undefined : state.licenseActivationMethod,
    providers: {
      ...(state.providers || {}),
      [ModelProviderEnum.ChatboxAI]: {
        ...(state.providers?.[ModelProviderEnum.ChatboxAI] || {}),
        apiHost: undefined,
        apiKey: undefined,
        models: [],
        excludedModels: [],
      },
    },
  }))
  queryClient.clear()
}

export async function deleteCurrentKodAccount(password: string): Promise<void> {
  const auth = authInfoStore.getState()
  if (!auth.accessToken || !auth.loginEmail)
    throw new Error('KOD login information is unavailable. Sign in again and retry.')
  const accountKey = deriveAccountKey(auth.loginEmail)

  await deleteKodAccount({ accessToken: auth.accessToken, password, confirmation: ACCOUNT_DELETE_CONFIRMATION })

  const cleanupErrors: unknown[] = []
  const cleanup = async (work: () => void | Promise<void>) => {
    try {
      await work()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  await cleanup(async () => {
    await purgeCurrentAccountData()
  })
  await cleanup(() => purgeTaskSessionData(accountKey))
  await cleanup(() => purgeImageGenerationData(accountKey))
  await cleanup(async () => {
    await suanbaoRuntime.close()
    const repository = getSuanbaoRepository(accountKey)
    await closeSuanbaoRepository(accountKey, repository)
    await repository.deleteDatabase()
  })
  await cleanup(() => purgeSuanbaoPreferences(accountKey))
  await cleanup(clearAccountCaches)

  authInfoStore.getState().clearTokens()
  resetMetaStorage()
  resetTaskSessionStorage()
  resetImageGenerationStorage()

  if (cleanupErrors.length) throw new AccountDeletedWithCleanupError(cleanupErrors)
}
