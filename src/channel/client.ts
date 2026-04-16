import WebSocket from 'ws'

type NotificationHandler = (method: string, params: unknown) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

export class HubClient {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private notificationHandler: NotificationHandler | null = null
  private opened = false

  constructor(private url: string) {
    this.ws = new WebSocket(url)
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.opened = true
        this.ws.off('error', onError)
        resolve()
      }
      const onError = (err: Error) => {
        this.ws.off('open', onOpen)
        reject(err)
      }
      this.ws.once('open', onOpen)
      this.ws.once('error', onError)
    })

    this.ws.on('message', raw => this.onMessage(raw.toString()))
    this.ws.on('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error('hub connection closed'))
      }
      this.pending.clear()
      if (this.opened) {
        console.error('[peer-channel] hub connection closed, exiting')
        process.exit(1)
      }
    })
    this.ws.on('error', err => {
      console.error(`[peer-channel] hub error: ${err.message}`)
    })
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++
    const payload = { jsonrpc: '2.0', id, method, params }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: v => resolve(v as T),
        reject,
      })
      this.ws.send(JSON.stringify(payload), err => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  private onMessage(raw: string): void {
    let msg: {
      id?: number
      result?: unknown
      error?: { code: number; message: string }
      method?: string
      params?: unknown
    }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error)) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.error) {
        pending.reject(new Error(msg.error.message))
      } else {
        pending.resolve(msg.result)
      }
      return
    }
    if (typeof msg.method === 'string' && this.notificationHandler) {
      this.notificationHandler(msg.method, msg.params)
    }
  }
}
