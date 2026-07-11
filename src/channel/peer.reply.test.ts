import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

const { testDir, testSessionsDir } = vi.hoisted(() => {
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const { randomBytes } = require('node:crypto')
  const testDir = join(tmpdir(), `peer-reply-test-${randomBytes(4).toString('hex')}`)
  return { testDir, testSessionsDir: join(testDir, 'sessions') }
})

vi.mock('../shared/paths.js', () => ({
  SESSIONS_DIR: testSessionsDir,
  lockTarget: (name: string) => join(testSessionsDir, name),
  sockPath: (name: string) => join(testSessionsDir, `${name}.sock`),
}))

import {
  claimName,
  sendDeliverWithReply,
  replyViaPending,
  type Peer,
} from './peer.js'

beforeAll(() => {
  mkdirSync(testSessionsDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('reply-over-same-connection integration', () => {
  const peers: Peer[] = []

  afterEach(async () => {
    for (const p of peers) await p.close()
    peers.length = 0
  })

  it('sender receives reply over same socket', async () => {
    const claim = await claimName('responder')
    const peer = await claim.listen(async params => {
      return { message_id: 'inbound-msg-id' }
    })
    peers.push(peer)

    const { result, waitForReply } = await sendDeliverWithReply(
      'responder',
      { from: 'initiator', text: 'question?', await_reply: 5 },
      3000,
    )
    expect(result.message_id).toBe('inbound-msg-id')

    const replyPromise = new Promise<any>(resolve => {
      waitForReply(reply => resolve(reply))
    })

    await new Promise(r => setTimeout(r, 50))

    const replied = await replyViaPending('inbound-msg-id', {
      from: 'responder',
      text: 'answer!',
      in_reply_to: 'inbound-msg-id',
    })
    expect(replied).toBe(true)

    const reply = await replyPromise
    expect(reply.from).toBe('responder')
    expect(reply.text).toBe('answer!')
    expect(reply.in_reply_to).toBe('inbound-msg-id')
  })

  it('falls back gracefully when reply times out', async () => {
    const claim = await claimName('slow-responder')
    const peer = await claim.listen(async params => {
      return { message_id: 'timeout-msg' }
    })
    peers.push(peer)

    const { result } = await sendDeliverWithReply(
      'slow-responder',
      { from: 'patient-sender', text: 'hello', await_reply: 1 },
      3000,
    )
    expect(result.message_id).toBe('timeout-msg')

    await new Promise(r => setTimeout(r, 1500))

    const replied = await replyViaPending('timeout-msg', {
      from: 'slow-responder',
      text: 'too late',
    })
    expect(replied).toBe(false)
  })

  it('works without await_reply (backwards compatible)', async () => {
    const claim = await claimName('compat-target')
    const peer = await claim.listen(async params => {
      return { message_id: 'compat-msg' }
    })
    peers.push(peer)

    const { result, waitForReply } = await sendDeliverWithReply(
      'compat-target',
      { from: 'old-sender', text: 'hi' },
      3000,
    )
    expect(result.message_id).toBe('compat-msg')
    waitForReply(() => { throw new Error('should not be called') })
  })
})
