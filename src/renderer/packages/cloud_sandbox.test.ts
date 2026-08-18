import { describe, expect, it } from 'vitest'
import { parseSseBlock } from './cloud_sandbox'

describe('cloud sandbox SSE parser', () => {
  it('parses authenticated task output events and their cursor', () => {
    expect(
      parseSseBlock('id: 42\nevent: stdout\ndata: {"operationId":"op-1","type":"stdout","payload":{"chunk":"ok"}}')
    ).toEqual({ id: 42, operationId: 'op-1', type: 'stdout', payload: { chunk: 'ok' } })
  })

  it('ignores malformed event data', () => {
    expect(parseSseBlock('event: stdout\ndata: not-json')).toBeNull()
  })
})
