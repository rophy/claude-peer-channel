# Privacy Policy

_Last updated: 2026-04-16_

`peer-channel` is a local-only Claude Code plugin. It does not collect, transmit,
or share any user data.

## What the plugin does

- Binds an `AF_UNIX` (filesystem) socket at `~/.peer-channel/sessions/<name>.sock`
  so other Claude Code sessions running as the same OS user can connect to it.
- Acquires a lockfile at `~/.peer-channel/sessions/<name>.lock` to claim a
  session name.
- Relays messages between peer sessions via direct Unix socket connections.

## What the plugin does **not** do

- No network access. No TCP, no HTTP, no DNS, no outbound connections of any
  kind. The plugin binds only `AF_UNIX` sockets, which never leave the local
  machine.
- No telemetry, analytics, crash reporting, or usage tracking.
- No persistent storage of message content. Messages are held only in memory
  (and in OS kernel socket buffers) while being delivered; they are discarded
  once delivery completes.
- No third-party services are contacted, installed, or invoked.

## Data accessible to the plugin

- **Session name.** Defaults to `basename($PWD)` of the Claude Code session, or
  the value of the `PEER_CHANNEL_SESSION_NAME` environment variable if set.
  Used only as the socket filename and as an identifier in peer-to-peer RPC.
- **Message bodies.** Text sent via `send_message` is passed through to the
  target session and is not logged, cached, or retained by the plugin.

## Access control

- The sessions directory is created with mode `0700`; sockets inherit the
  user's umask and are not readable by other OS users by default.
- Only processes running as the same OS user on the same machine can connect
  to the socket. There is no remote access path.

## Contact

Questions or concerns: open an issue at
https://github.com/rophy/claude-peer-channel/issues
