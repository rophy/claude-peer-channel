import { describe, it, expect, afterEach } from 'vitest'
import { defaultSessionName, randomSuffix, withSuffix } from './names.js'

describe('defaultSessionName', () => {
  const origEnv = process.env.PEER_CHANNEL_SESSION_NAME

  afterEach(() => {
    if (origEnv === undefined) delete process.env.PEER_CHANNEL_SESSION_NAME
    else process.env.PEER_CHANNEL_SESSION_NAME = origEnv
  })

  it('uses PEER_CHANNEL_SESSION_NAME env var when set', () => {
    process.env.PEER_CHANNEL_SESSION_NAME = 'my-session'
    expect(defaultSessionName('/some/path')).toBe('my-session')
  })

  it('falls back to directory basename', () => {
    delete process.env.PEER_CHANNEL_SESSION_NAME
    expect(defaultSessionName('/home/user/my-project')).toBe('my-project')
  })

  it('returns "session" for empty basename', () => {
    delete process.env.PEER_CHANNEL_SESSION_NAME
    expect(defaultSessionName('')).toBe('session')
  })
})

describe('randomSuffix', () => {
  it('returns a 4-character hex string', () => {
    const s = randomSuffix()
    expect(s).toMatch(/^[0-9a-f]{4}$/)
  })
})

describe('withSuffix', () => {
  it('appends a hex suffix', () => {
    const result = withSuffix('test')
    expect(result).toMatch(/^test-[0-9a-f]{4}$/)
  })
})
