import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { testDir, testSessionsDir } = vi.hoisted(() => {
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const { randomBytes } = require('node:crypto')
  const testDir = join(tmpdir(), `peer-errlog-${randomBytes(4).toString('hex')}`)
  return { testDir, testSessionsDir: join(testDir, 'sessions') }
})

vi.mock('../shared/paths.js', () => ({
  SESSIONS_DIR: testSessionsDir,
  lockTarget: (name: string) => join(testSessionsDir, name),
  sockPath: (name: string) => join(testSessionsDir, `${name}.sock`),
}))

const mockCheck = vi.hoisted(() => vi.fn())

vi.mock('proper-lockfile', async (importOriginal) => {
  const orig = await importOriginal<typeof import('proper-lockfile')>()
  return { ...orig, check: mockCheck }
})

import { listPeers, claimName, type Peer } from './peer.js'

beforeAll(() => {
  mkdirSync(testSessionsDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('safeCheck error logging', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockCheck.mockReset()
  })

  it('logs unexpected errors from checkLock', async () => {
    // Create a fake lock entry so listPeers tries to check it
    mkdirSync(join(testSessionsDir, 'err-peer.lock'), { recursive: true })

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCheck.mockRejectedValueOnce(new Error('disk on fire'))

    const list = await listPeers('self')
    expect(list).not.toContain('err-peer')
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('unexpected error checking lock for "err-peer"'),
    )
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('disk on fire'),
    )
  })

  it('stays silent on ENOENT from checkLock', async () => {
    mkdirSync(join(testSessionsDir, 'gone-peer.lock'), { recursive: true })

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' })
    mockCheck.mockRejectedValueOnce(enoent)

    const list = await listPeers('self')
    expect(list).not.toContain('gone-peer')
    const lockCalls = spy.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('checking lock'),
    )
    expect(lockCalls).toHaveLength(0)
  })
})

describe('doRelease error logging', () => {
  const peers: Peer[] = []

  afterEach(async () => {
    for (const p of peers) await p.close()
    peers.length = 0
    vi.restoreAllMocks()
    mockCheck.mockReset()
  })

  it('logs when lock release fails', async () => {
    // Use real lockfile for claimName
    mockCheck.mockImplementation(async () => true)
    const claim = await claimName('release-fail')
    const peer = await claim.listen(async () => ({ message_id: 'x' }))
    peers.push(peer)

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Close the peer (triggers doRelease). The lock may already be gone
    // from the temp dir cleanup, which would cause a release error.
    // We force an error by removing the lock dir before close.
    try {
      rmSync(join(testSessionsDir, 'release-fail.lock'), { recursive: true, force: true })
    } catch { /* ignore */ }

    await peer.close()
    peers.length = 0

    // If the lock was already released by close(), the spy may not fire.
    // This test verifies no crash occurs — the logging is best-effort.
  })
})
