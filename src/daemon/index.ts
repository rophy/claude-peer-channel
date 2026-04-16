#!/usr/bin/env node
import { startServer } from './server.js'

const port = Number.parseInt(process.env.PORT ?? '7777', 10)
if (!Number.isFinite(port) || port <= 0) {
  console.error(`[peer-channel] invalid PORT: ${process.env.PORT}`)
  process.exit(1)
}

const wss = startServer(port)

function shutdown(sig: string): void {
  console.log(`[peer-channel] ${sig} received, shutting down`)
  wss.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 2000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
