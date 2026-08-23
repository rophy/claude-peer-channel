import { describe, it, expect } from 'vitest'
import { PingResult, DeliverParams, DeliverResult } from './protocol.js'

describe('PingResult', () => {
  it('accepts valid ping result', () => {
    const res = PingResult.safeParse({ name: 'foo', version: '0.0.1', protocol: 1 })
    expect(res.success).toBe(true)
  })

  it('rejects missing fields', () => {
    expect(PingResult.safeParse({ name: 'foo' }).success).toBe(false)
    expect(PingResult.safeParse({}).success).toBe(false)
  })

  it('rejects wrong types', () => {
    expect(PingResult.safeParse({ name: 123, version: '1', protocol: 1 }).success).toBe(false)
    expect(PingResult.safeParse({ name: 'a', version: 'b', protocol: 'c' }).success).toBe(false)
  })
})

describe('DeliverParams', () => {
  it('accepts valid params', () => {
    const res = DeliverParams.safeParse({ from: 'alice', message: 'hello' })
    expect(res.success).toBe(true)
  })

  it('accepts optional in_reply_to', () => {
    const res = DeliverParams.safeParse({ from: 'alice', message: 'hi', in_reply_to: 'msg-1' })
    expect(res.success).toBe(true)
    expect(res.data?.in_reply_to).toBe('msg-1')
  })

  it('rejects empty from', () => {
    expect(DeliverParams.safeParse({ from: '', message: 'hi' }).success).toBe(false)
  })

  it('rejects missing message', () => {
    expect(DeliverParams.safeParse({ from: 'alice' }).success).toBe(false)
  })

  it('rejects empty message', () => {
    expect(DeliverParams.safeParse({ from: 'alice', message: '' }).success).toBe(false)
  })

  it('accepts await_reply in DeliverParams', () => {
    const result = DeliverParams.safeParse({
      from: 'alice',
      message: 'hello',
      await_reply: 120,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.await_reply).toBe(120)
    }
  })

  it('allows DeliverParams without await_reply', () => {
    const result = DeliverParams.safeParse({
      from: 'alice',
      message: 'hello',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.await_reply).toBeUndefined()
    }
  })
})

describe('DeliverResult', () => {
  it('accepts valid result', () => {
    const res = DeliverResult.safeParse({ message_id: 'abc-123' })
    expect(res.success).toBe(true)
  })

  it('rejects missing message_id', () => {
    expect(DeliverResult.safeParse({}).success).toBe(false)
  })

  it('rejects non-string message_id', () => {
    expect(DeliverResult.safeParse({ message_id: 42 }).success).toBe(false)
  })
})
