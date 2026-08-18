import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ofetchMock } = vi.hoisted(() => ({ ofetchMock: vi.fn() }))
vi.mock('ofetch', () => ({ ofetch: ofetchMock }))
vi.mock('@/platform', () => ({ default: { type: 'desktop' } }))
vi.mock('@/stores/authInfoStore', () => ({ authInfoStore: { getState: vi.fn() } }))
vi.mock('../../shared/request/chatboxai_pool', () => ({ getChatboxAPIOrigin: () => 'https://legacy.invalid' }))
vi.mock('../../shared/request/request', () => ({
  createAfetch: vi.fn(),
  createAuthenticatedAfetch: vi.fn(),
  uploadFile: vi.fn(),
}))
vi.mock('./navigator', () => ({ getOS: () => 'Windows' }))

import { deleteKodAccount, loginWithKod, refreshAccessToken } from './remote'

describe('deleteKodAccount', () => {
  beforeEach(() => ofetchMock.mockReset())
  it('sends authenticated DELETE with fixed confirmation and accepts empty data', async () => {
    ofetchMock.mockResolvedValue({ code: 0, message: 'ok', data: null })
    await expect(deleteKodAccount({ accessToken: 'token', password: 'secret' })).resolves.toBeUndefined()
    expect(ofetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/account$/),
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
        body: { password: 'secret', confirmation: 'DELETE' },
        ignoreResponseError: true,
      })
    )
  })
  it('surfaces KOD result errors', async () => {
    ofetchMock.mockResolvedValue({ code: 401, message: 'Incorrect password', data: null })
    await expect(deleteKodAccount({ accessToken: 'token', password: 'bad' })).rejects.toThrow('Incorrect password')
  })
})

describe('loginWithKod', () => {
  beforeEach(() => ofetchMock.mockReset())
  it('uses the unified login endpoint and maps the token', async () => {
    ofetchMock.mockResolvedValue({
      code: 0,
      message: '',
      data: { token: 'kod-token', refreshToken: 'kod-refresh-token', newUser: true },
    })
    await expect(
      loginWithKod({ email: 'user@example.com', password: 'secret', inviteCode: 'invite' })
    ).resolves.toEqual({
      accessToken: 'kod-token',
      refreshToken: 'kod-refresh-token',
      newUser: true,
    })
    expect(ofetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/login$/),
      expect.objectContaining({
        method: 'POST',
        body: { email: 'user@example.com', password: 'secret', inviteCode: 'invite' },
        ignoreResponseError: true,
      })
    )
  })

  it('keeps backward compatibility with a server that has not added refresh tokens yet', async () => {
    ofetchMock.mockResolvedValue({ code: 0, message: '', data: { token: 'legacy-token', newUser: false } })

    await expect(loginWithKod({ email: 'user@example.com', password: 'secret' })).resolves.toMatchObject({
      accessToken: 'legacy-token',
      refreshToken: 'legacy-token',
    })
  })
})

describe('refreshAccessToken', () => {
  beforeEach(() => ofetchMock.mockReset())

  it('rotates the dedicated KOD refresh token', async () => {
    ofetchMock.mockResolvedValue({
      code: 0,
      message: '',
      data: { token: 'next-access', refreshToken: 'next-refresh' },
    })

    await expect(refreshAccessToken({ refreshToken: 'old-refresh' })).resolves.toEqual({
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
    })
    expect(ofetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/refresh$/),
      expect.objectContaining({
        method: 'POST',
        body: { refreshToken: 'old-refresh' },
        retry: 0,
      })
    )
  })
})
