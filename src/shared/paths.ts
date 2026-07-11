import { homedir } from 'node:os'
import { join } from 'node:path'

export const SESSIONS_DIR = join(homedir(), '.peer-channel', 'sessions')

export function lockTarget(name: string): string {
  return join(SESSIONS_DIR, name)
}

export function sockPath(name: string): string {
  return join(SESSIONS_DIR, `${name}.sock`)
}

export const HOST_SESSIONS_DIR = '/run/peer-channel'

export function hostLockTarget(username: string, sessionName: string): string {
  return join(HOST_SESSIONS_DIR, username, sessionName)
}

export function hostSockPath(username: string, sessionName: string): string {
  return join(HOST_SESSIONS_DIR, username, `${sessionName}.sock`)
}
