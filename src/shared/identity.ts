import { userInfo } from 'node:os'
import type { Socket } from 'node:net'

export interface PeerCredentials {
  uid: number
  gid: number
  pid: number
}

export interface CurrentUser {
  username: string
  uid: number
}

export function getCurrentUser(): CurrentUser {
  const info = userInfo()
  return { username: info.username, uid: info.uid }
}

export function getPeerCredentials(socket: Socket): PeerCredentials | null {
  // Node.js doesn't natively expose SO_PEERCRED (Linux) or LOCAL_PEERCRED (macOS).
  // For v1, peer identity is derived from the socket path namespace.
  // A native N-API addon can be added later for runtime verification.
  return null
}
