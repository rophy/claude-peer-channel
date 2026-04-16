import { basename } from 'node:path'
import { randomBytes } from 'node:crypto'

export function defaultSessionName(cwd: string = process.cwd()): string {
  const fromEnv = process.env.CCC_SESSION_NAME?.trim()
  if (fromEnv) return fromEnv
  const base = basename(cwd)
  return base || 'session'
}

export function randomSuffix(): string {
  return randomBytes(2).toString('hex')
}

export function withSuffix(name: string): string {
  return `${name}-${randomSuffix()}`
}
