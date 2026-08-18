import type { Settings } from '@shared/types'

const MODEL_SETTING_KEYS = [
  'providers',
  'customProviders',
  'favoritedModels',
  'defaultChatModel',
  'threadNamingModel',
  'searchTermConstructionModel',
  'ocrModel',
] as const satisfies ReadonlyArray<keyof Settings>

export function getModelSyncPayload(settings: Settings): Partial<Settings> {
  const payload: Partial<Settings> = {}
  for (const key of MODEL_SETTING_KEYS) {
    ;(payload as Record<string, unknown>)[key] = settings[key]
  }
  return payload
}
