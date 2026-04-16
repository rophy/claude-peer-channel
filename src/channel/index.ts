#!/usr/bin/env node
import { defaultSessionName } from '../shared/names.js'
import { METHODS, type RegisterResult } from '../shared/protocol.js'
import { HubClient } from './client.js'
import { buildMcpServer, connectStdio } from './mcp.js'

async function main(): Promise<void> {
  const url = process.env.PEER_CHANNEL_URL ?? 'ws://127.0.0.1:7777'
  const requestedName = defaultSessionName()

  const hub = new HubClient(url)
  try {
    await hub.connect()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[peer-channel] failed to connect to hub at ${url}: ${msg}\n` +
        `[peer-channel] is the peer-channel hub running?`,
    )
    process.exit(1)
  }

  let assigned: string
  try {
    const res = await hub.request<RegisterResult>(METHODS.register, {
      name: requestedName,
    })
    assigned = res.assigned_name
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[peer-channel] register failed: ${msg}`)
    process.exit(1)
  }

  console.error(`[peer-channel] registered as: ${assigned}`)

  const mcp = buildMcpServer(hub)
  await connectStdio(mcp)
}

main().catch(err => {
  console.error(`[peer-channel] fatal: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
