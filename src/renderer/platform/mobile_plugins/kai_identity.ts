import { registerPlugin } from '@capacitor/core'
import type { KaiIdentityConfig, KaiIdentityLoginResult } from '@shared/kai-identity'

interface KaiIdentityNativePlugin {
  login(options: { config: KaiIdentityConfig }): Promise<KaiIdentityLoginResult>
  cancel(): Promise<void>
}

export const KaiIdentityNative = registerPlugin<KaiIdentityNativePlugin>('KaiIdentity')
