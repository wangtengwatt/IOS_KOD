import { registerPlugin } from '@capacitor/core'

interface SecureStorageNativePlugin {
  getAuthState(): Promise<{ found: boolean; value?: string }>
  setAuthState(options: { value: string }): Promise<void>
  clearAuthState(): Promise<void>
}

export const SecureStorageNative = registerPlugin<SecureStorageNativePlugin>('SecureStorage')
