import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const { testDir, testHostDir, testUserDir } = vi.hoisted(() => {
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const { randomBytes } = require('node:crypto')
  const testDir = join(tmpdir(), `peer-host-test-${randomBytes(4).toString('hex')}`)
  return {
    testDir,
    testHostDir: join(testDir, 'host'),
    testUserDir: join(testDir, 'user'),
  }
})

vi.mock('../shared/paths.js', () => ({
  SESSIONS_DIR: testUserDir,
  HOST_SESSIONS_DIR: testHostDir,
  lockTarget: (name: string) => join(testUserDir, name),
  sockPath: (name: string) => join(testUserDir, `${name}.sock`),
  hostLockTarget: (username: string, session: string) =>
    join(testHostDir, username, session),
  hostSockPath: (username: string, session: string) =>
    join(testHostDir, username, `${session}.sock`),
}))

vi.mock('../shared/identity.js', () => ({
  getCurrentUser: () => ({ username: 'testuser', uid: 1000 }),
}))

vi.mock('../shared/config.js', () => ({
  isHostLevel: vi.fn(() => true),
}))

import { claimName, listPeers, sendDeliver, type Peer } from './peer.js'
import type { PeerContext } from '../shared/protocol.js'

beforeAll(() => {
  mkdirSync(testHostDir, { recursive: true })
  mkdirSync(testUserDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('host-level claimName', () => {
  const peers: Peer[] = []

  afterEach(async () => {
    for (const p of peers) await p.close()
    peers.length = 0
  })

  it('registers with the username prefix', async () => {
    const claim = await claimName('myservice')
    expect(claim.name).toBe('testuser/myservice')
    const peer = await claim.listen(async () => ({ message_id: 't' }))
    peers.push(peer)
    expect(peer.name).toBe('testuser/myservice')
  })

  it('fails on name collision instead of suffixing', async () => {
    const claim1 = await claimName('collide')
    const peer1 = await claim1.listen(async () => ({ message_id: 't1' }))
    peers.push(peer1)

    await expect(claimName('collide')).rejects.toThrow(
      /Host-level session 'testuser\/collide' is already running/,
    )
  })

  it('creates the user subdirectory under the host dir', async () => {
    const claim = await claimName('subdir-check')
    const peer = await claim.listen(async () => ({ message_id: 't' }))
    peers.push(peer)
    expect(existsSync(join(testHostDir, 'testuser'))).toBe(true)
  })
})

describe('host-level listPeers', () => {
  const peers: Peer[] = []

  afterEach(async () => {
    for (const p of peers) await p.close()
    peers.length = 0
  })

  it('discovers host-level peers with username prefix', async () => {
    const claimA = await claimName('list-a')
    const peerA = await claimA.listen(async () => ({ message_id: 'a' }))
    peers.push(peerA)

    const claimB = await claimName('list-b')
    const peerB = await claimB.listen(async () => ({ message_id: 'b' }))
    peers.push(peerB)

    const list = await listPeers('testuser/list-a')
    expect(list).toContain('testuser/list-b')
    expect(list).not.toContain('testuser/list-a')
  })
})

describe('host-level sendDeliver', () => {
  const peers: Peer[] = []

  afterEach(async () => {
    for (const p of peers) await p.close()
    peers.length = 0
  })

  it('delivers to a host-level peer by prefixed name and passes peer context', async () => {
    const claim = await claimName('receiver')
    let received: { from: string; text: string } | null = null
    let ctx: PeerContext | undefined
    const peer = await claim.listen(async (params, context) => {
      received = { from: params.from, text: params.text }
      ctx = context
      return { message_id: 'reply-1' }
    })
    peers.push(peer)

    const result = await sendDeliver('testuser/receiver', {
      from: 'testuser/sender',
      text: 'hello',
    })
    expect(result.message_id).toBe('reply-1')
    expect(received).toEqual({ from: 'testuser/sender', text: 'hello' })
    expect(ctx).toEqual({ peer_user: 'testuser' })
  })
})
