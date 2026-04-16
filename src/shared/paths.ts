import { homedir } from 'node:os'
import { join } from 'node:path'

export const SESSIONS_DIR = join(homedir(), '.peer-channel', 'sessions')

export function lockTarget(name: string): string {
  return join(SESSIONS_DIR, name)
}

export function sockPath(name: string): string {
  return join(SESSIONS_DIR, `${name}.sock`)
}
