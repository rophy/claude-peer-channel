import { chmodSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import * as net from 'node:net'
import { join } from 'node:path'
import { check as checkLock, lock as acquireLock } from 'proper-lockfile'
import { isHostLevel } from '../shared/config.js'
import { getCurrentUser } from '../shared/identity.js'
import { withSuffix } from '../shared/names.js'
import {
  HOST_SESSIONS_DIR,
  SESSIONS_DIR,
  hostLockTarget,
  hostSockPath,
  lockTarget,
  sockPath,
} from '../shared/paths.js'
import {
  DeliverParams,
  DeliverResult,
  ERROR_CODES,
  METHODS,
  PROTOCOL_VERSION,
  PeerContext,
  PingResult,
} from '../shared/protocol.js'

const VERSION = '0.1.0'
const LOCK_OPTS = {
  stale: 10000,
  update: 5000,
  realpath: false,
  retries: 0,
  onCompromised: (err: Error) => {
    console.error(`[peer-channel] lock compromised: ${err.message}`)
  },
} as const

interface PendingReply {
  socket: net.Socket
  timer: ReturnType<typeof setTimeout>
}

const pendingReplies = new Map<string, PendingReply>()

export type DeliverHandler = (
  params: DeliverParams,
  context?: PeerContext,
) => Promise<DeliverResult>

function resolveSocketPath(name: string): string {
  const slash = name.indexOf('/')
  if (slash !== -1) {
    return hostSockPath(name.slice(0, slash), name.slice(slash + 1))
  }
  return sockPath(name)
}

function resolveLockTarget(name: string): string {
  const slash = name.indexOf('/')
  if (slash !== -1) {
    return hostLockTarget(name.slice(0, slash), name.slice(slash + 1))
  }
  return lockTarget(name)
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

export interface NameClaim {
  name: string
  listen(handler: DeliverHandler): Promise<Peer>
  release(): Promise<void>
}

export interface Peer {
  name: string
  close(): Promise<void>
}

export async function claimName(requestedName: string): Promise<NameClaim> {
  const hostLevel = isHostLevel()
  let name: string
  let release: (() => Promise<void>) | null = null

  if (hostLevel) {
    const { username } = getCurrentUser()
    mkdirSync(join(HOST_SESSIONS_DIR, username), { recursive: true, mode: 0o755 })
    name = `${username}/${requestedName}`
    try {
      release = await acquireLock(hostLockTarget(username, requestedName), LOCK_OPTS)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ELOCKED') {
        throw new Error(
          `Host-level session '${username}/${requestedName}' is already running. Only one instance allowed.`,
        )
      }
      throw err
    }
  } else {
    mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 })
    let candidate = requestedName
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        release = await acquireLock(lockTarget(candidate), LOCK_OPTS)
        break
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ELOCKED') {
          candidate = withSuffix(requestedName)
          continue
        }
        throw err
      }
    }
    if (!release) {
      throw new Error(
        `could not claim a session name after 10 attempts (base: ${requestedName})`,
      )
    }
    name = candidate
  }

  const releaseLock = release
  let released = false
  const doRelease = async (): Promise<void> => {
    if (released) return
    released = true
    try {
      await releaseLock()
    } catch (err) {
      console.error(`[peer-channel] failed to release lock for "${name}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const sp = resolveSocketPath(name)

  try {
    unlinkSync(sp)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[peer-channel] unexpected error removing stale socket: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  process.on('exit', () => {
    try {
      unlinkSync(sp)
    } catch {
      /* ignore */
    }
  })

  return {
    name,
    release: doRelease,
    async listen(handler: DeliverHandler): Promise<Peer> {
      const server = net.createServer(socket =>
        handleConn(socket, name, handler, hostLevel),
      )
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(sp, () => {
            server.off('error', reject)
            resolve()
          })
        })
      } catch (err) {
        await doRelease()
        throw err
      }

      if (hostLevel) {
        chmodSync(sp, 0o666)
      }

      let closed = false
      const close = async (): Promise<void> => {
        if (closed) return
        closed = true
        await new Promise<void>(resolve => server.close(() => resolve()))
        try {
          unlinkSync(sp)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error(`[peer-channel] unexpected error removing socket on close: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        await doRelease()
      }

      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(sig, () => {
          close().finally(() => process.exit(0))
        })
      }

      return { name, close }
    },
  }
}

function handleConn(
  socket: net.Socket,
  myName: string,
  handleDeliver: DeliverHandler,
  hostLevel: boolean,
): void {
  let buf = ''
  let handled = false

  socket.on('data', async chunk => {
    try {
      if (handled) return
      buf += chunk.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      handled = true
      const line = buf.slice(0, nl).trim()

      let req: JsonRpcRequest
      try {
        req = JSON.parse(line)
      } catch {
        sendError(socket, null, ERROR_CODES.PARSE, 'parse error')
        socket.end()
        return
      }
      if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
        sendError(socket, req.id ?? null, ERROR_CODES.INVALID_REQUEST, 'invalid request')
        socket.end()
        return
      }

      let keepOpen = false

      try {
        if (req.method === METHODS.ping) {
          const result: PingResult = {
            name: myName,
            version: VERSION,
            protocol: PROTOCOL_VERSION,
          }
          sendResult(socket, req.id, result)
        } else if (req.method === METHODS.deliver) {
          const parsed = DeliverParams.safeParse(req.params)
          if (!parsed.success) {
            sendError(socket, req.id, ERROR_CODES.INVALID_PARAMS, 'invalid params')
          } else {
            let context: PeerContext | undefined
            if (hostLevel) {
              const slash = parsed.data.from.indexOf('/')
              if (slash !== -1) {
                context = { peer_user: parsed.data.from.slice(0, slash) }
              } else {
                context = { peer_user: 'unknown' }
              }
            }
            const result = await handleDeliver(parsed.data, context)
            sendResult(socket, req.id, result)

            if (parsed.data.await_reply) {
              keepOpen = true
              const messageId = result.message_id
              const timer = setTimeout(() => {
                pendingReplies.delete(messageId)
                socket.destroy()
              }, parsed.data.await_reply * 1000)
              timer.unref()
              pendingReplies.set(messageId, { socket, timer })
              socket.on('close', () => {
                clearTimeout(timer)
                pendingReplies.delete(messageId)
              })
            }
          }
        } else {
          sendError(
            socket,
            req.id,
            ERROR_CODES.METHOD_NOT_FOUND,
            `method not found: ${req.method}`,
          )
        }
      } catch (err) {
        sendError(
          socket,
          req.id ?? null,
          ERROR_CODES.INTERNAL,
          err instanceof Error ? err.message : 'internal error',
        )
      }
      if (!keepOpen) {
        socket.end()
      }
    } catch (err) {
      console.error(`[peer-channel] unhandled error in connection handler: ${err instanceof Error ? err.message : String(err)}`)
      try { socket.destroy() } catch { /* ignore */ }
    }
  })

  socket.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
      console.error(`[peer-channel] unexpected socket error from peer: ${err.message}`)
    }
  })
}

function sendResult(
  socket: net.Socket,
  id: number | string | null,
  result: unknown,
): void {
  socket.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function sendError(
  socket: net.Socket,
  id: number | string | null,
  code: number,
  message: string,
): void {
  socket.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

export async function listPeers(selfName: string): Promise<string[]> {
  const names = new Set<string>()

  try {
    for (const e of readdirSync(SESSIONS_DIR)) {
      if (e.endsWith('.lock')) {
        const n = e.slice(0, -'.lock'.length)
        if (n) names.add(n)
      }
    }
  } catch {
    /* ignore */
  }

  try {
    for (const userEntry of readdirSync(HOST_SESSIONS_DIR, { withFileTypes: true })) {
      if (!userEntry.isDirectory()) continue
      const username = userEntry.name
      let subEntries: string[]
      try {
        subEntries = readdirSync(join(HOST_SESSIONS_DIR, username))
      } catch {
        continue
      }
      for (const e of subEntries) {
        if (e.endsWith('.lock')) {
          const n = e.slice(0, -'.lock'.length)
          if (n) names.add(`${username}/${n}`)
        }
      }
    }
  } catch {
    /* ignore */
  }

  const candidates = [...names].filter(n => n !== selfName)

  const probed = await Promise.all(
    candidates.map(async n => {
      const locked = await safeCheck(n)
      if (!locked) {
        try {
          unlinkSync(resolveSocketPath(n))
        } catch {
          /* ignore */
        }
        return null
      }
      return (await ping(n, 500)) ? n : null
    }),
  )
  return probed.filter((v): v is string => !!v).sort()
}

async function safeCheck(name: string): Promise<boolean> {
  try {
    return await checkLock(resolveLockTarget(name), { realpath: false, stale: 10000 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[peer-channel] unexpected error checking lock for "${name}": ${err instanceof Error ? err.message : String(err)}`)
    }
    return false
  }
}

async function ping(name: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await rpcCall(name, METHODS.ping, {}, timeoutMs)
    return PingResult.safeParse(res).success
  } catch {
    return false
  }
}

export async function sendDeliver(
  target: string,
  params: DeliverParams,
  timeoutMs = 5000,
): Promise<DeliverResult> {
  const res = await rpcCall(target, METHODS.deliver, params, timeoutMs)
  const parsed = DeliverResult.safeParse(res)
  if (!parsed.success) throw new Error('malformed deliver response')
  return parsed.data
}

export function replyViaPending(
  messageId: string,
  params: DeliverParams,
): Promise<boolean> {
  const pending = pendingReplies.get(messageId)
  if (!pending) return Promise.resolve(false)

  pendingReplies.delete(messageId)
  clearTimeout(pending.timer)

  return new Promise<boolean>(resolve => {
    const req = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: METHODS.deliver,
      params,
    }
    pending.socket.write(JSON.stringify(req) + '\n', err => {
      pending.socket.destroy()
      resolve(!err)
    })
  })
}

export async function sendDeliverWithReply(
  target: string,
  params: DeliverParams,
  timeoutMs = 5000,
): Promise<{ result: DeliverResult; waitForReply: (cb: (reply: DeliverParams) => void) => void }> {
  const sp = resolveSocketPath(target)
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sp)
    let buf = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(`timeout contacting "${target}"`))
    }, timeoutMs)

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        reject(new Error(`peer "${target}" is not reachable (socket ${code === 'ENOENT' ? 'not found' : 'refused'})`))
      } else {
        reject(err)
      }
    }

    socket.on('error', fail)
    socket.on('connect', () => {
      socket.write(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: METHODS.deliver, params }) + '\n',
      )
    })
    socket.on('data', chunk => {
      buf += chunk.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl === -1) return

      if (!settled) {
        settled = true
        clearTimeout(timer)
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        try {
          const msg = JSON.parse(line) as {
            error?: { code: number; message: string }
            result?: unknown
          }
          if (msg.error) {
            socket.destroy()
            reject(new Error(msg.error.message || 'rpc error'))
            return
          }
          const parsed = DeliverResult.safeParse(msg.result)
          if (!parsed.success) {
            socket.destroy()
            reject(new Error('malformed deliver response'))
            return
          }

          const awaitSec = params.await_reply ?? 0
          if (awaitSec <= 0) {
            socket.destroy()
            resolve({ result: parsed.data, waitForReply: () => {} })
            return
          }

          let replyCb: ((reply: DeliverParams) => void) | null = null
          const replyTimer = setTimeout(() => {
            socket.destroy()
          }, awaitSec * 1000)
          replyTimer.unref()

          socket.on('close', () => {
            clearTimeout(replyTimer)
          })

          const checkReply = () => {
            const nl2 = buf.indexOf('\n')
            if (nl2 === -1) return
            const replyLine = buf.slice(0, nl2)
            buf = buf.slice(nl2 + 1)
            clearTimeout(replyTimer)
            try {
              const replyMsg = JSON.parse(replyLine)
              if (replyMsg.method === METHODS.deliver && replyMsg.params) {
                const replyParsed = DeliverParams.safeParse(replyMsg.params)
                if (replyParsed.success && replyCb) {
                  replyCb(replyParsed.data)
                }
              }
            } catch { /* ignore malformed reply */ }
            socket.destroy()
          }

          checkReply()

          socket.on('data', () => checkReply())

          resolve({
            result: parsed.data,
            waitForReply: cb => { replyCb = cb },
          })
        } catch (e) {
          socket.destroy()
          reject(e instanceof Error ? e : new Error('parse error'))
        }
      }
    })
    socket.on('end', () => {
      if (!settled) fail(new Error('connection closed without response'))
    })
  })
}

function rpcCall(
  name: string,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(resolveSocketPath(name))
    let buf = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(`timeout contacting "${name}"`))
    }, timeoutMs)

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        reject(new Error(`peer "${name}" is not reachable (socket ${code === 'ENOENT' ? 'not found' : 'refused'})`))
      } else {
        reject(err)
      }
    }
    const ok = (val: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(val)
    }

    socket.on('error', fail)
    socket.on('connect', () => {
      socket.write(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n',
      )
    })
    socket.on('data', chunk => {
      buf += chunk.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      const line = buf.slice(0, nl)
      try {
        const msg = JSON.parse(line) as {
          error?: { code: number; message: string }
          result?: unknown
        }
        if (msg.error) fail(new Error(msg.error.message || 'rpc error'))
        else ok(msg.result)
      } catch (e) {
        fail(e instanceof Error ? e : new Error('parse error'))
      }
    })
    socket.on('end', () => {
      if (!settled) fail(new Error('connection closed without response'))
    })
  })
}
