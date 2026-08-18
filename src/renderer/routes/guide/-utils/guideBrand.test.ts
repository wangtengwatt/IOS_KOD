import { describe, expect, it } from 'vitest'
import { brandGuideText } from './guideBrand'

describe('brandGuideText', () => {
  it('replaces legacy product names and domains in guide content', () => {
    const result = brandGuideText(
      'Boxy uses Chatbox AI. Open https://chatboxai.app or contact hi@chatboxai.com for Chatbox help.'
    )

    expect(result).toBe('KOD 新手助手 uses KOD AI. Open https://kod.kai.com or contact kod.kai.com for KOD help.')
  })

  it('does not change already branded KOD content', () => {
    expect(brandGuideText('欢迎使用 KOD 算力中心')).toBe('欢迎使用 KOD 算力中心')
  })
})
