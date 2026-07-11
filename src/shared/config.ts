import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function isHostLevel(cwd: string = process.cwd()): boolean {
  const envVal = process.env.PEER_CHANNEL_HOST_LEVEL?.trim().toLowerCase()
  if (envVal !== undefined) return envVal === 'true'

  try {
    const content = readFileSync(join(cwd, '.env'), 'utf8')
    const match = content.match(/^PEER_CHANNEL_HOST_LEVEL\s*=\s*(.+)$/m)
    if (match) return match[1].trim().toLowerCase() === 'true'
  } catch {
    // .env not found or unreadable
  }

  return false
}
