import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeKodAuthReturnTo, KOD_AUTH_RETURN_STORAGE_KEY, rememberKodAuthReturnTo } from './kodAuthReturn'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
})

describe('KOD authentication return path', () => {
  it('stores and consumes the compute-center return exactly once', () => {
    rememberKodAuthReturnTo('/compute-center')

    expect(consumeKodAuthReturnTo()).toBe('/compute-center')
    expect(consumeKodAuthReturnTo()).toBeNull()
  })

  it('rejects an untrusted stored path and still clears it', () => {
    values.set(KOD_AUTH_RETURN_STORAGE_KEY, 'https://example.com/redirect')

    expect(consumeKodAuthReturnTo()).toBeNull()
    expect(values.has(KOD_AUTH_RETURN_STORAGE_KEY)).toBe(false)
  })
})
