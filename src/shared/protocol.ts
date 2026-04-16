import { z } from 'zod'

export const PROTOCOL_VERSION = 1

export const RegisterParams = z.object({
  name: z.string().min(1),
})
export const RegisterResult = z.object({
  assigned_name: z.string(),
})

export const ListSessionsParams = z.object({})
export const ListSessionsResult = z.object({
  sessions: z.array(z.string()),
})

export const SendMessageParams = z.object({
  to: z.string().min(1),
  text: z.string(),
  in_reply_to: z.string().optional(),
})
export const SendMessageResult = z.object({
  message_id: z.string(),
})

export const DeliverNotification = z.object({
  from: z.string(),
  text: z.string(),
  message_id: z.string(),
  in_reply_to: z.string().optional(),
})

export type RegisterParams = z.infer<typeof RegisterParams>
export type RegisterResult = z.infer<typeof RegisterResult>
export type ListSessionsResult = z.infer<typeof ListSessionsResult>
export type SendMessageParams = z.infer<typeof SendMessageParams>
export type SendMessageResult = z.infer<typeof SendMessageResult>
export type DeliverNotification = z.infer<typeof DeliverNotification>

export const METHODS = {
  register: 'register',
  listSessions: 'list_sessions',
  sendMessage: 'send_message',
} as const

export const NOTIFICATIONS = {
  deliver: 'deliver',
} as const

export const ERROR_CODES = {
  SESSION_NOT_FOUND: -32001,
  NOT_REGISTERED: -32002,
  ALREADY_REGISTERED: -32003,
} as const
