import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import * as net from 'node:net'
import { check as checkLock, lock as acquireLock } from 'proper-lockfile'
import { withSuffix } from '../shared/names.js'
import { SESSIONS_DIR, lockTarget, sockPath } from '../shared/paths.js'
import {
  DeliverParams,
  DeliverResult,
  ERROR_CODES,
  METHODS,
  PROTOCOL_VERSION,
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

export type DeliverHandler = (params: DeliverParams) => Promise<DeliverResult>

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
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 })

  let candidate = requestedName
  let release: (() => Promise<void>) | null = null

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

  const name = candidate
  const releaseLock = release
  let released = false
  const doRelease = async (): Promise<void> => {
    if (released) return
    released = true
    try {
      await releaseLock()
    } catch {
      /* ignore */
    }
  }

  try {
    unlinkSync(sockPath(name))
  } catch {
    /* stale socket may or may not exist */
  }

  process.on('exit', () => {
    try {
      unlinkSync(sockPath(name))
    } catch {
      /* ignore */
    }
  })

  return {
    name,
    release: doRelease,
    async listen(handler: DeliverHandler): Promise<Peer> {
      const sp = sockPath(name)
      const server = net.createServer(socket => handleConn(socket, name, handler))
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

      let closed = false
      const close = async (): Promise<void> => {
        if (closed) return
        closed = true
        await new Promise<void>(resolve => server.close(() => resolve()))
        try {
          unlinkSync(sp)
        } catch {
          /* ignore */
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
): void {
  let buf = ''
  let handled = false

  socket.on('data', async chunk => {
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
          const result = await handleDeliver(parsed.data)
          sendResult(socket, req.id, result)
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
    socket.end()
  })

  socket.on('error', () => {
    /* one-shot peer connections often close abruptly; ignore */
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
  let entries: string[]
  try {
    entries = readdirSync(SESSIONS_DIR)
  } catch {
    return []
  }
  const names = new Set<string>()
  for (const e of entries) {
    if (e.endsWith('.lock')) {
      const n = e.slice(0, -'.lock'.length)
      if (n) names.add(n)
    }
  }
  const candidates = [...names].filter(n => n !== selfName)

  const probed = await Promise.all(
    candidates.map(async n => {
      const locked = await safeCheck(n)
      if (!locked) {
        try {
          unlinkSync(sockPath(n))
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
    return await checkLock(lockTarget(name), { realpath: false, stale: 10000 })
  } catch {
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

function rpcCall(
  name: string,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath(name))
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
      reject(err)
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
