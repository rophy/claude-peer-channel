import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./peer.js', () => ({
  listPeers: vi.fn(),
  sendDeliver: vi.fn(),
  replyViaPending: vi.fn(),
  sendDeliverWithReply: vi.fn(),
}))

import { buildMcpServer } from './mcp.js'
import { listPeers, replyViaPending, sendDeliverWithReply } from './peer.js'

const mockedListPeers = vi.mocked(listPeers)
const mockedReplyViaPending = vi.mocked(replyViaPending)
const mockedSendDeliverWithReply = vi.mocked(sendDeliverWithReply)

function callTool(server: ReturnType<typeof buildMcpServer>['server'], name: string, args: Record<string, unknown> = {}) {
  const handler = (server as any)._requestHandlers?.get('tools/call')
  if (!handler) throw new Error('No tools/call handler registered')
  return handler({ method: 'tools/call', params: { name, arguments: args } })
}

function listTools(server: ReturnType<typeof buildMcpServer>['server']) {
  const handler = (server as any)._requestHandlers?.get('tools/list')
  if (!handler) throw new Error('No tools/list handler registered')
  return handler({ method: 'tools/list', params: {} })
}

describe('buildMcpServer', () => {
  it('returns a server and handleDeliver', () => {
    const bundle = buildMcpServer('test-session')
    expect(bundle.server).toBeDefined()
    expect(bundle.handleDeliver).toBeTypeOf('function')
  })
})

describe('tool listing', () => {
  it('exposes list_sessions, whoami, and send_message', async () => {
    const { server } = buildMcpServer('my-session')
    const result = await listTools(server)
    const names = result.tools.map((t: any) => t.name)
    expect(names).toContain('list_sessions')
    expect(names).toContain('whoami')
    expect(names).toContain('send_message')
  })
})

describe('whoami tool', () => {
  it('returns the session name', async () => {
    const { server } = buildMcpServer('my-session')
    const result = await callTool(server, 'whoami')
    expect(result.content[0].text).toBe('my-session')
  })
})

describe('list_sessions tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns peer list', async () => {
    mockedListPeers.mockResolvedValue(['alice', 'bob'])
    const { server } = buildMcpServer('me')
    const result = await callTool(server, 'list_sessions')
    expect(result.content[0].text).toBe('- alice\n- bob')
    expect(mockedListPeers).toHaveBeenCalledWith('me')
  })

  it('returns message when no peers', async () => {
    mockedListPeers.mockResolvedValue([])
    const { server } = buildMcpServer('me')
    const result = await callTool(server, 'list_sessions')
    expect(result.content[0].text).toBe('No other sessions connected.')
  })

  it('tags host-level peers in output', async () => {
    mockedListPeers.mockResolvedValue(['alice', 'expose-web/default'])
    const { server } = buildMcpServer('me')
    const result = await callTool(server, 'list_sessions')
    expect(result.content[0].text).toBe('- alice\n- expose-web/default [host]')
  })
})

describe('send_message tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends a message and returns message_id', async () => {
    mockedSendDeliverWithReply.mockResolvedValue({
      result: { message_id: 'msg-42' },
      waitForReply: () => {},
    })
    const { server } = buildMcpServer('sender')
    const result = await callTool(server, 'send_message', { to: 'target', message: 'hi' })
    expect(result.content[0].text).toBe('sent (message_id=msg-42)')
    expect(mockedSendDeliverWithReply).toHaveBeenCalledWith('target', {
      from: 'sender',
      message: 'hi',
      await_reply: 120,
    })
  })

  it('passes in_reply_to when provided', async () => {
    mockedReplyViaPending.mockResolvedValue(false)
    mockedSendDeliverWithReply.mockResolvedValue({
      result: { message_id: 'msg-43' },
      waitForReply: () => {},
    })
    const { server } = buildMcpServer('sender')
    await callTool(server, 'send_message', { to: 'target', message: 'reply', in_reply_to: 'orig' })
    expect(mockedReplyViaPending).toHaveBeenCalledWith('orig', {
      from: 'sender',
      message: 'reply',
      in_reply_to: 'orig',
    })
    expect(mockedSendDeliverWithReply).toHaveBeenCalledWith('target', {
      from: 'sender',
      message: 'reply',
      in_reply_to: 'orig',
      await_reply: 120,
    })
  })
})

describe('send_message with reply-over-same-connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses replyViaPending when pending connection exists', async () => {
    mockedReplyViaPending.mockResolvedValue(true)
    const { server } = buildMcpServer('responder')
    const result = await callTool(server, 'send_message', {
      to: 'requester',
      message: 'reply text',
      in_reply_to: 'orig-msg-id',
    })
    expect(mockedReplyViaPending).toHaveBeenCalledWith('orig-msg-id', {
      from: 'responder',
      message: 'reply text',
      in_reply_to: 'orig-msg-id',
    })
    expect(mockedSendDeliverWithReply).not.toHaveBeenCalled()
    expect(result.content[0].text).toBe('sent (reply over existing connection)')
  })

  it('falls back to sendDeliverWithReply when no pending connection', async () => {
    mockedReplyViaPending.mockResolvedValue(false)
    mockedSendDeliverWithReply.mockResolvedValue({
      result: { message_id: 'fallback-msg' },
      waitForReply: () => {},
    })
    const { server } = buildMcpServer('responder')
    const result = await callTool(server, 'send_message', {
      to: 'requester',
      message: 'reply text',
      in_reply_to: 'orig-msg-id',
    })
    expect(mockedReplyViaPending).toHaveBeenCalled()
    expect(mockedSendDeliverWithReply).toHaveBeenCalled()
    expect(result.content[0].text).toBe('sent (message_id=fallback-msg)')
  })

  it('emits channel notification when reply arrives on sender side', async () => {
    let replyCb: ((reply: any) => void) | undefined
    mockedSendDeliverWithReply.mockResolvedValue({
      result: { message_id: 'sent-msg-1' },
      waitForReply: cb => { replyCb = cb },
    })
    const { server } = buildMcpServer('sender')
    const notifSpy = vi.spyOn(server, 'notification').mockResolvedValue(undefined)

    await callTool(server, 'send_message', { to: 'target', message: 'hello' })

    expect(replyCb).toBeDefined()
    replyCb!({ from: 'target', message: 'reply text', in_reply_to: 'sent-msg-1' })

    // Allow async notification to fire
    await new Promise(r => setTimeout(r, 10))

    expect(notifSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'notifications/claude/channel',
        params: expect.objectContaining({
          content: 'reply text',
          meta: expect.objectContaining({
            from: 'target',
            in_reply_to: 'sent-msg-1',
            reply_tool: 'send_message',
          }),
        }),
      }),
    )
  })
})

describe('unknown tool', () => {
  it('throws for unknown tool name', async () => {
    const { server } = buildMcpServer('me')
    await expect(callTool(server, 'no_such_tool')).rejects.toThrow('unknown tool')
  })
})

describe('handleDeliver', () => {
  it('returns a message_id', async () => {
    const { server, handleDeliver } = buildMcpServer('receiver')
    // Mock the notification method since server isn't connected to a transport
    vi.spyOn(server, 'notification').mockResolvedValue(undefined)
    const result = await handleDeliver({ from: 'alice', message: 'hello' })
    expect(result.message_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(server.notification).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'notifications/claude/channel',
        params: expect.objectContaining({
          content: 'hello',
          meta: expect.objectContaining({ from: 'alice' }),
        }),
      }),
    )
  })
})

describe('handleDeliver with peer context', () => {
  it('includes peer_user in notification meta for host-level messages', async () => {
    const { server, handleDeliver } = buildMcpServer('receiver')
    vi.spyOn(server, 'notification').mockResolvedValue(undefined)
    const result = await handleDeliver(
      { from: 'cat/myproject', message: 'hello' },
      { peer_user: 'cat', peer_uid: 1001 },
    )
    expect(result.message_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(server.notification).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          meta: expect.objectContaining({
            from: 'cat/myproject',
            peer_user: 'cat',
            peer_uid: '1001',
          }),
        }),
      }),
    )
  })

  it('omits peer_user for user-level messages (no context)', async () => {
    const { server, handleDeliver } = buildMcpServer('receiver')
    vi.spyOn(server, 'notification').mockResolvedValue(undefined)
    await handleDeliver({ from: 'alice', message: 'hi' })
    const call = vi.mocked(server.notification).mock.calls[0][0] as any
    expect(call.params.meta.peer_user).toBeUndefined()
    expect(call.params.meta.peer_uid).toBeUndefined()
  })
})
