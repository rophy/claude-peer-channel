import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isHostLevel } from './config.js'

describe('isHostLevel', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peer-channel-config-test-'))
    delete process.env.PEER_CHANNEL_HOST_LEVEL
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PEER_CHANNEL_HOST_LEVEL
  })

  it('returns true when env var is "true"', () => {
    process.env.PEER_CHANNEL_HOST_LEVEL = 'true'
    expect(isHostLevel(dir)).toBe(true)
  })

  it('returns false when env var is "false"', () => {
    process.env.PEER_CHANNEL_HOST_LEVEL = 'false'
    expect(isHostLevel(dir)).toBe(false)
  })

  it('falls back to .env file when env var is not set', () => {
    writeFileSync(join(dir, '.env'), 'PEER_CHANNEL_HOST_LEVEL=true\n')
    expect(isHostLevel(dir)).toBe(true)
  })

  it('returns false when .env file does not exist', () => {
    expect(isHostLevel(dir)).toBe(false)
  })

  it('env var takes precedence over .env file', () => {
    writeFileSync(join(dir, '.env'), 'PEER_CHANNEL_HOST_LEVEL=true\n')
    process.env.PEER_CHANNEL_HOST_LEVEL = 'false'
    expect(isHostLevel(dir)).toBe(false)
  })
})
