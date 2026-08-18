import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getKaiIdentityConfig,
  KOD_AUTH_REQUEST_TIMEOUT_MS,
  loginWithKaiIdentity,
  loginWithKod,
  sendKodEmailCode,
} from './remote'

const KOD_ORIGIN = 'https://kod.kai.com'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function readBody(init: RequestInit | undefined) {
  if (typeof init?.body === 'string') return JSON.parse(init.body)
  return init?.body
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loginWithKod', () => {
  it('sends email, password, inviteCode and emailCode to /api/auth/login', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 0, message: '', data: { token: 'tok-1', newUser: true } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await loginWithKod({
      email: 'a@b.com',
      password: 'pw',
      inviteCode: 'inv',
      emailCode: '123456',
    })

    expect(result).toEqual({ accessToken: 'tok-1', refreshToken: 'tok-1', newUser: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${KOD_ORIGIN}/api/auth/login`)
    expect(init.method).toBe('POST')
    expect(readBody(init)).toEqual({
      email: 'a@b.com',
      password: 'pw',
      inviteCode: 'inv',
      emailCode: '123456',
    })
  })

  it('omits inviteCode and emailCode when not provided (ordinary login)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 0, message: '', data: { token: 'tok-2', newUser: false } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await loginWithKod({ email: 'user@example.com ', password: 'pw' })

    expect(result).toEqual({ accessToken: 'tok-2', refreshToken: 'tok-2', newUser: false })
    const [, init] = fetchMock.mock.calls[0]
    const body = readBody(init)
    expect(body).toEqual({ email: 'user@example.com ', password: 'pw' })
    expect(body).not.toHaveProperty('inviteCode')
    expect(body).not.toHaveProperty('emailCode')
  })

  it('throws on nonzero KOD envelope code with server message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 1001, message: 'invalid credentials' })))
    await expect(loginWithKod({ email: 'a@b.com', password: 'pw' })).rejects.toThrow('invalid credentials')
  })

  it('throws when data is missing despite code 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 0, message: 'no data' })))
    await expect(loginWithKod({ email: 'a@b.com', password: 'pw' })).rejects.toThrow()
  })

  it('aborts a stalled login request and reports a readable connection error', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted', 'AbortError'))
        )
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    vi.useFakeTimers()
    try {
      const loginPromise = loginWithKod({ email: 'a@b.com', password: 'pw' })
      const assertion = expect(loginPromise).rejects.toThrow(
        '登录服务连接超时，请确认本机后端已启动且数据库网络可用后重试'
      )
      await vi.advanceTimersByTimeAsync(KOD_AUTH_REQUEST_TIMEOUT_MS)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('sendKodEmailCode', () => {
  it('posts email to /api/auth/send-code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 0, message: '', data: null }))
    vi.stubGlobal('fetch', fetchMock)

    await sendKodEmailCode('a@b.com')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${KOD_ORIGIN}/api/auth/send-code`)
    expect(init.method).toBe('POST')
    expect(readBody(init)).toEqual({ email: 'a@b.com' })
  })

  it('resolves when code is 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 0, message: '', data: null })))
    await expect(sendKodEmailCode('a@b.com')).resolves.toBeUndefined()
  })

  it('throws with server message on nonzero code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 1002, message: 'rate limited' })))
    await expect(sendKodEmailCode('a@b.com')).rejects.toThrow('rate limited')
  })

  it('throws default message when server message is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 1003, message: '' })))
    await expect(sendKodEmailCode('a@b.com')).rejects.toThrow('发送验证码失败')
  })
})

describe('KAI Identity login', () => {
  it('loads the public PKCE configuration from the KOD backend', async () => {
    const config = {
      enabled: true,
      clientId: 'kod-desktop',
      issuer: 'https://auth.kai.com/api/auth',
      authorizationEndpoint: 'https://auth.kai.com/api/auth/oauth2/authorize',
      tokenEndpoint: 'https://auth.kai.com/api/auth/oauth2/token',
      redirectUri: 'http://127.0.0.1:1456/auth/callback',
      scope: 'openid profile email',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: config }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getKaiIdentityConfig()).resolves.toEqual(config)
    expect(fetchMock.mock.calls[0][0]).toBe(`${KOD_ORIGIN}/api/auth/kai/config?client=desktop`)
  })

  it('exchanges the Identity access token for a normal KOD session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: { token: 'kod-jwt', newUser: false, email: 'user@kai.com' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(loginWithKaiIdentity('identity-access-token')).resolves.toEqual({
      accessToken: 'kod-jwt',
      refreshToken: 'kod-jwt',
      newUser: false,
      email: 'user@kai.com',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${KOD_ORIGIN}/api/auth/kai/exchange`)
    expect(init.method).toBe('POST')
    expect(readBody(init)).toEqual({ accessToken: 'identity-access-token' })
  })
})
