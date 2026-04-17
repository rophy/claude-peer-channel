import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./peer.js', () => ({
  listPeers: vi.fn(),
  sendDeliver: vi.fn(),
}))

import { buildMcpServer } from './mcp.js'
import { listPeers, sendDeliver } from './peer.js'

const mockedListPeers = vi.mocked(listPeers)
const mockedSendDeliver = vi.mocked(sendDeliver)

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
})

describe('send_message tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends a message and returns message_id', async () => {
    mockedSendDeliver.mockResolvedValue({ message_id: 'msg-42' })
    const { server } = buildMcpServer('sender')
    const result = await callTool(server, 'send_message', { to: 'target', text: 'hi' })
    expect(result.content[0].text).toBe('sent (message_id=msg-42)')
    expect(mockedSendDeliver).toHaveBeenCalledWith('target', { from: 'sender', text: 'hi' })
  })

  it('passes in_reply_to when provided', async () => {
    mockedSendDeliver.mockResolvedValue({ message_id: 'msg-43' })
    const { server } = buildMcpServer('sender')
    await callTool(server, 'send_message', { to: 'target', text: 'reply', in_reply_to: 'orig' })
    expect(mockedSendDeliver).toHaveBeenCalledWith('target', {
      from: 'sender',
      text: 'reply',
      in_reply_to: 'orig',
    })
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
    const result = await handleDeliver({ from: 'alice', text: 'hello' })
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
