import { describe, expect, it } from 'vitest'
import { collectMediaStorageKeys } from './media'

describe('cross-device media synchronization', () => {
  it('collects only private image and video keys and removes duplicates', () => {
    const cyclic: Record<string, unknown> = {
      images: ['picture:chat:1', 'https://example.com/public.png', 'picture:chat:1'],
      nested: { video: 'video:generation:2', file: 'file:document:3' },
    }
    cyclic.self = cyclic

    expect(collectMediaStorageKeys(cyclic)).toEqual(['picture:chat:1', 'video:generation:2'])
  })

  it('does not mistake ordinary text for an object key', () => {
    expect(collectMediaStorageKeys({ prompt: 'draw a picture: of a tree', count: 2 })).toEqual([])
  })
})
