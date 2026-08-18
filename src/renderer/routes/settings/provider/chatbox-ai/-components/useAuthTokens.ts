import { ModelProviderEnum } from '@shared/types'
import { useCallback, useMemo } from 'react'
import { clearKodRelayLocalState } from '@/hooks/useKodRelay'
import { releaseKodRelayKey } from '@/packages/kodRelay'
import { getKodApiOrigin } from '@/packages/remote'
import { authInfoStore, useAuthInfoStore } from '@/stores/authInfoStore'
import { purgeCurrentAccountData, resetMetaStorage } from '@/stores/chatStore'
import { resetImageGenerationStorage } from '@/stores/imageGenerationStore'
import * as premiumActions from '@/stores/premiumActions'
import queryClient from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import { resetTaskSessionStorage } from '@/stores/taskSessionStore'
import type { AuthTokens } from './types'

function reportLogoutCleanupFailure(task: string, error: unknown) {
  console.warn(`[KOD logout] ${task} failed`, error)
}

/**
 * End the local authenticated session immediately. Remote release and local
 * account-data cleanup are best-effort follow-up work and must never keep the
 * user signed in.
 */
export function clearKodAuthSession() {
  const auth = authInfoStore.getState()
  const relayToken = auth.accessToken
  const settings = settingsStore.getState()

  // Start cleanup while loginEmail still identifies the account database, but
  // deliberately do not await it: IndexedDB deletion can be blocked by another
  // open connection indefinitely.
  const accountCleanup = purgeCurrentAccountData()
  const licenseCleanup =
    settings.licenseActivationMethod === 'login' ? premiumActions.deactivate(false) : Promise.resolve()

  // Authentication termination is the critical operation and must happen
  // before any fallible network request or storage cleanup.
  auth.clearTokens()

  try {
    clearKodRelayLocalState()
  } catch (error) {
    reportLogoutCleanupFailure('clear relay state', error)
  }

  try {
    settingsStore.setState((state) => ({
      hasExpiredLicense: false,
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
  } catch (error) {
    reportLogoutCleanupFailure('clear provider state', error)
  }

  resetMetaStorage()
  resetTaskSessionStorage()
  resetImageGenerationStorage()
  queryClient.clear()

  if (relayToken) {
    void releaseKodRelayKey(getKodApiOrigin(), relayToken).catch((error) =>
      reportLogoutCleanupFailure('release relay key', error)
    )
  }
  void accountCleanup.catch((error) => reportLogoutCleanupFailure('purge local account data', error))
  void licenseCleanup.catch((error) => reportLogoutCleanupFailure('deactivate login license', error))
}

export function useAuthTokens() {
  const accessToken = useAuthInfoStore((state) => state.accessToken)
  const refreshToken = useAuthInfoStore((state) => state.refreshToken)

  const isLoggedIn = useMemo(() => {
    return !!accessToken && !!refreshToken
  }, [accessToken, refreshToken])

  const saveAuthTokens = useCallback(async (tokens: AuthTokens) => {
    try {
      await authInfoStore.getState().setTokens({
        ...tokens,
        email: tokens.email,
      })
    } catch (error) {
      console.error('❌ Failed to save tokens:', error)
      throw error
    }
  }, [])

  const clearAuthTokens = useCallback(() => {
    clearKodAuthSession()
  }, [])

  return {
    isLoggedIn,
    clearAuthTokens,
    saveAuthTokens,
  }
}
