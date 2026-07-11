#!/usr/bin/env node
import { isHostLevel } from '../shared/config.js'
import { defaultSessionName } from '../shared/names.js'
import { buildMcpServer, connectStdio } from './mcp.js'
import { claimName } from './peer.js'

async function main(): Promise<void> {
  const requestedName = defaultSessionName()
  const hostLevel = isHostLevel()

  let claim
  try {
    claim = await claimName(requestedName)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[peer-channel] failed to claim session name: ${msg}`)
    process.exit(1)
  }

  const level = hostLevel ? 'host-level' : 'user-level'
  console.error(`[peer-channel] registered as: ${claim.name} (${level})`)

  const { server, handleDeliver } = buildMcpServer(claim.name)

  try {
    await claim.listen(handleDeliver)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[peer-channel] failed to start peer listener: ${msg}`)
    process.exit(1)
  }

  await connectStdio(server)
}

main().catch(err => {
  console.error(
    `[peer-channel] fatal: ${err instanceof Error ? err.message : err}`,
  )
  process.exit(1)
})
