import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SESSIONS_DIR, lockTarget, sockPath } from './paths.js'

describe('SESSIONS_DIR', () => {
  it('is under ~/.peer-channel/sessions', () => {
    expect(SESSIONS_DIR).toBe(join(homedir(), '.peer-channel', 'sessions'))
  })
})

describe('lockTarget', () => {
  it('returns path inside sessions dir', () => {
    expect(lockTarget('my-session')).toBe(join(SESSIONS_DIR, 'my-session'))
  })
})

describe('sockPath', () => {
  it('returns .sock path inside sessions dir', () => {
    expect(sockPath('my-session')).toBe(join(SESSIONS_DIR, 'my-session.sock'))
  })
})
