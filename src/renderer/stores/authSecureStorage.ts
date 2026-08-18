import type { StateStorage } from 'zustand/middleware'
import { SecureStorageNative } from '@/platform/mobile_plugins/secure_storage'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from '@/variables'

const isNativeIos = CHATBOX_BUILD_TARGET === 'mobile_app' && CHATBOX_BUILD_PLATFORM === 'ios'
const memoryFallback = new Map<string, string>()

function browserStorage(): Storage | undefined {
  return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
}

function getLocal(name: string): string | null {
  return browserStorage()?.getItem(name) ?? memoryFallback.get(name) ?? null
}

function setLocal(name: string, value: string): void {
  const storage = browserStorage()
  if (storage) storage.setItem(name, value)
  else memoryFallback.set(name, value)
}

function removeLocal(name: string): void {
  browserStorage()?.removeItem(name)
  memoryFallback.delete(name)
}

export const authSecureStorage: StateStorage = {
  async getItem(name) {
    if (!isNativeIos) return getLocal(name)
    const result = await SecureStorageNative.getAuthState()
    if (result.found && result.value) return result.value

    // One-time migration from builds that persisted credentials in WebKit localStorage.
    const legacy = getLocal(name)
    if (legacy) {
      await SecureStorageNative.setAuthState({ value: legacy })
      removeLocal(name)
    }
    return legacy
  },
  async setItem(_name, value) {
    if (!isNativeIos) {
      setLocal(_name, value)
      return
    }
    await SecureStorageNative.setAuthState({ value })
    removeLocal(_name)
  },
  async removeItem(name) {
    if (!isNativeIos) {
      removeLocal(name)
      return
    }
    await SecureStorageNative.clearAuthState()
    removeLocal(name)
  },
}
