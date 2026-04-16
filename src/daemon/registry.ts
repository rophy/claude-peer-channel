import type { WebSocket } from 'ws'
import { withSuffix } from '../shared/names.js'

interface Entry {
  name: string
  ws: WebSocket
}

export class SessionRegistry {
  private byName = new Map<string, Entry>()
  private byWs = new WeakMap<WebSocket, Entry>()

  register(requested: string, ws: WebSocket): string {
    let name = requested
    while (this.byName.has(name)) {
      name = withSuffix(requested)
    }
    const entry = { name, ws }
    this.byName.set(name, entry)
    this.byWs.set(ws, entry)
    return name
  }

  unregister(ws: WebSocket): string | undefined {
    const entry = this.byWs.get(ws)
    if (!entry) return undefined
    this.byName.delete(entry.name)
    this.byWs.delete(ws)
    return entry.name
  }

  nameFor(ws: WebSocket): string | undefined {
    return this.byWs.get(ws)?.name
  }

  target(name: string): WebSocket | undefined {
    return this.byName.get(name)?.ws
  }

  list(): string[] {
    return [...this.byName.keys()].sort()
  }
}
