import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

const { testDir, testSessionsDir } = vi.hoisted(() => {
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const { randomBytes } = require('node:crypto')
  const testDir = join(tmpdir(), `peer-test-${randomBytes(4).toString('hex')}`)
  return { testDir, testSessionsDir: join(testDir, 'sessions') }
})

vi.mock('../shared/paths.js', () => ({
  SESSIONS_DIR: testSessionsDir,
  lockTarget: (name: string) => join(testSessionsDir, name),
  sockPath: (name: string) => join(testSessionsDir, `${name}.sock`),
}))

import { claimName, listPeers, sendDeliver, type Peer } from './peer.js'

beforeAll(() => {
  mkdirSync(testSessionsDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('claimName', () => {
  const peers: Peer[] = []

  afterEach(async () => {
    for (const p of peers) await p.close()
    peers.length = 0
  })

  it('claims the requested name', async () => {
    const claim = await claimName('alpha')
    expect(claim.name).toBe('alpha')
    const peer = await claim.listen(async params => ({ message_id: 'test' }))
    peers.push(peer)
    expect(peer.name).toBe('alpha')
  })

  it('appends suffix when name is taken', async () => {
    const claim1 = await claimName('beta')
    const peer1 = await claim1.listen(async () => ({ message_id: 't1' }))
    peers.push(peer1)

    const claim2 = await claimName('beta')
    expect(claim2.name).toMatch(/^beta-[0-9a-f]{4}$/)
    const peer2 = await claim2.listen(async () => ({ message_id: 't2' }))
    peers.push(peer2)
  })
})

describe('listPeers', () => {
  const peers: Peer[] = []

  afterEach(async () => {
    for (const p of peers) await p.close()
    peers.length = 0
  })

  it('excludes self and includes others', async () => {
    const claimA = await claimName('peer-a')
    const peerA = await claimA.listen(async () => ({ message_id: 'a' }))
    peers.push(peerA)

    const claimB = await claimName('peer-b')
    const peerB = await claimB.listen(async () => ({ message_id: 'b' }))
    peers.push(peerB)

    const list = await listPeers('peer-a')
    expect(list).toContain('peer-b')
    expect(list).not.toContain('peer-a')
  })

  it('returns empty when no other peers', async () => {
    const claim = await claimName('lonely')
    const peer = await claim.listen(async () => ({ message_id: 'l' }))
    peers.push(peer)

    const list = await listPeers('lonely')
    expect(list).toEqual([])
  })
})

describe('sendDeliver + handleConn round-trip', () => {
  const peers: Peer[] = []

  afterEach(async () => {
    for (const p of peers) await p.close()
    peers.length = 0
  })

  it('delivers a message and returns message_id', async () => {
    const claim = await claimName('receiver')
    let received: { from: string; text: string } | null = null
    const peer = await claim.listen(async params => {
      received = { from: params.from, text: params.text }
      return { message_id: 'reply-1' }
    })
    peers.push(peer)

    const result = await sendDeliver('receiver', { from: 'sender', text: 'hello' })
    expect(result.message_id).toBe('reply-1')
    expect(received).toEqual({ from: 'sender', text: 'hello' })
  })

  it('delivers with in_reply_to', async () => {
    const claim = await claimName('echo')
    let gotReplyTo: string | undefined
    const peer = await claim.listen(async params => {
      gotReplyTo = params.in_reply_to
      return { message_id: 'reply-2' }
    })
    peers.push(peer)

    await sendDeliver('echo', { from: 'x', text: 'hi', in_reply_to: 'orig-msg' })
    expect(gotReplyTo).toBe('orig-msg')
  })

  it('rejects when target is not reachable', async () => {
    await expect(
      sendDeliver('nonexistent', { from: 'a', text: 'b' }, 500),
    ).rejects.toThrow()
  })
})
