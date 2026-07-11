import { z } from 'zod'

export const PROTOCOL_VERSION = 1

export const PingResult = z.object({
  name: z.string(),
  version: z.string(),
  protocol: z.number(),
})

export const DeliverParams = z.object({
  from: z.string().min(1),
  text: z.string(),
  in_reply_to: z.string().optional(),
  await_reply: z.number().positive().optional(),
})

export const DeliverResult = z.object({
  message_id: z.string(),
})

export type PingResult = z.infer<typeof PingResult>
export type DeliverParams = z.infer<typeof DeliverParams>
export type DeliverResult = z.infer<typeof DeliverResult>

export interface PeerContext {
  peer_user?: string
  peer_uid?: number
}

export const METHODS = {
  ping: 'ping',
  deliver: 'deliver',
} as const

export const ERROR_CODES = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const
