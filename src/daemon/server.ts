import { WebSocketServer, type WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import {
  RegisterParams,
  SendMessageParams,
  METHODS,
  NOTIFICATIONS,
  ERROR_CODES,
  type RegisterResult,
  type ListSessionsResult,
  type SendMessageResult,
  type DeliverNotification,
} from '../shared/protocol.js'
import { SessionRegistry } from './registry.js'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: number | string
  result: unknown
}

interface JsonRpcError {
  jsonrpc: '2.0'
  id: number | string | null
  error: { code: number; message: string; data?: unknown }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

function sendJson(ws: WebSocket, payload: unknown): void {
  ws.send(JSON.stringify(payload))
}

function reply(ws: WebSocket, id: number | string, result: unknown): void {
  const msg: JsonRpcSuccess = { jsonrpc: '2.0', id, result }
  sendJson(ws, msg)
}

function replyError(
  ws: WebSocket,
  id: number | string | null,
  code: number,
  message: string,
): void {
  const msg: JsonRpcError = { jsonrpc: '2.0', id, error: { code, message } }
  sendJson(ws, msg)
}

function notify(ws: WebSocket, method: string, params: unknown): void {
  const msg: JsonRpcNotification = { jsonrpc: '2.0', method, params }
  sendJson(ws, msg)
}

export function startServer(port: number): WebSocketServer {
  const registry = new SessionRegistry()
  const wss = new WebSocketServer({ host: '0.0.0.0', port })

  wss.on('connection', ws => {
    ws.on('message', raw => {
      let req: JsonRpcRequest
      try {
        req = JSON.parse(raw.toString())
      } catch {
        replyError(ws, null, -32700, 'parse error')
        return
      }

      if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
        replyError(ws, req.id ?? null, -32600, 'invalid request')
        return
      }

      try {
        handle(req, ws, registry)
      } catch (err) {
        replyError(
          ws,
          req.id ?? null,
          -32603,
          err instanceof Error ? err.message : 'internal error',
        )
      }
    })

    ws.on('close', () => {
      const name = registry.unregister(ws)
      if (name) {
        console.log(`[ccc-hub] unregistered: ${name}`)
      }
    })
  })

  wss.on('listening', () => {
    console.log(`[ccc-hub] listening on :${port}`)
  })

  return wss
}

function handle(req: JsonRpcRequest, ws: WebSocket, registry: SessionRegistry): void {
  switch (req.method) {
    case METHODS.register: {
      if (registry.nameFor(ws)) {
        replyError(ws, req.id, ERROR_CODES.ALREADY_REGISTERED, 'already registered')
        return
      }
      const params = RegisterParams.parse(req.params)
      const assigned = registry.register(params.name, ws)
      console.log(`[ccc-hub] registered: ${assigned}`)
      const result: RegisterResult = { assigned_name: assigned }
      reply(ws, req.id, result)
      return
    }
    case METHODS.listSessions: {
      if (!registry.nameFor(ws)) {
        replyError(ws, req.id, ERROR_CODES.NOT_REGISTERED, 'not registered')
        return
      }
      const result: ListSessionsResult = { sessions: registry.list() }
      reply(ws, req.id, result)
      return
    }
    case METHODS.sendMessage: {
      const from = registry.nameFor(ws)
      if (!from) {
        replyError(ws, req.id, ERROR_CODES.NOT_REGISTERED, 'not registered')
        return
      }
      const params = SendMessageParams.parse(req.params)
      const target = registry.target(params.to)
      if (!target) {
        replyError(
          ws,
          req.id,
          ERROR_CODES.SESSION_NOT_FOUND,
          `session not found: ${params.to}`,
        )
        return
      }
      const message_id = randomUUID()
      const deliver: DeliverNotification = {
        from,
        text: params.text,
        message_id,
        ...(params.in_reply_to ? { in_reply_to: params.in_reply_to } : {}),
      }
      notify(target, NOTIFICATIONS.deliver, deliver)
      const result: SendMessageResult = { message_id }
      reply(ws, req.id, result)
      return
    }
    default:
      replyError(ws, req.id, -32601, `method not found: ${req.method}`)
  }
}
