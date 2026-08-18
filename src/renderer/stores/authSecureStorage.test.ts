import { afterEach, describe, expect, it, vi } from 'vitest'
import { authSecureStorage } from './authSecureStorage'

afterEach(async () => {
  await authSecureStorage.removeItem('test-auth')
  vi.unstubAllGlobals()
})

describe('authSecureStorage fallback', () => {
  it('works without browser localStorage', async () => {
    vi.stubGlobal('localStorage', undefined)
    await authSecureStorage.setItem('test-auth', 'value')
    await expect(authSecureStorage.getItem('test-auth')).resolves.toBe('value')
    await authSecureStorage.removeItem('test-auth')
    await expect(authSecureStorage.getItem('test-auth')).resolves.toBeNull()
  })
})
