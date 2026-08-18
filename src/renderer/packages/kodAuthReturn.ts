export const KOD_AUTH_RETURN_STORAGE_KEY = 'kod-auth-return-to'

export type KodAuthReturnPath = '/compute-center'

const allowedReturnPaths = new Set<KodAuthReturnPath>(['/compute-center'])

function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function rememberKodAuthReturnTo(path: KodAuthReturnPath) {
  getSessionStorage()?.setItem(KOD_AUTH_RETURN_STORAGE_KEY, path)
}

export function consumeKodAuthReturnTo(): KodAuthReturnPath | null {
  const storage = getSessionStorage()
  const value = storage?.getItem(KOD_AUTH_RETURN_STORAGE_KEY)
  storage?.removeItem(KOD_AUTH_RETURN_STORAGE_KEY)
  return value && allowedReturnPaths.has(value as KodAuthReturnPath) ? (value as KodAuthReturnPath) : null
}
