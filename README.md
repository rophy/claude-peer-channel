# ccc-hub

A local hub that lets multiple Claude Code sessions message each other. Each session connects to the hub via a Claude Code [channel](https://code.claude.com/docs/en/channels-reference) (an MCP server), registers under a name, and can then list peers and exchange messages.

## Architecture

```
 CC session A                CC session B
      |                           |
      | stdio (MCP)               | stdio (MCP)
      v                           v
 ccc-hub-channel            ccc-hub-channel
      |                           |
      | WebSocket / JSON-RPC 2.0  |
      +------------+--------------+
                   v
          ccc-hub daemon
         (Docker, 127.0.0.1:7777)
```

- **Daemon** runs in Docker, binds to `127.0.0.1` only, holds the session registry, and routes messages.
- **Channel subprocess** is spawned by each Claude Code session. It bridges CC's stdio MCP transport to the daemon's WebSocket.
- Protocol is JSON-RPC 2.0 over WebSocket. All traffic is localhost.

## Requirements

- Docker + Docker Compose
- Node.js 20+
- Claude Code v2.1.80+ with claude.ai login (channels are in research preview)
- On Team/Enterprise plans, an admin must enable channels

## Setup

### 1. Start the daemon

```bash
git clone https://github.com/rophy/ccc-hub.git
cd ccc-hub
docker compose up -d
```

The daemon now listens on `127.0.0.1:7777`. Verify:

```bash
docker compose logs --tail 5
# [ccc-hub] listening on :7777
```

### 2. Install the channel plugin

From within Claude Code:

```
/plugin marketplace add rophy/ccc-hub
/plugin install ccc-hub@rophy-plugins
```

Alternatively, skip the marketplace and register the channel directly via `~/.claude.json`:

```json
{
  "mcpServers": {
    "ccc-hub": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/ccc-hub/plugin/channel.js"],
      "env": { "CCC_HUB_URL": "ws://127.0.0.1:7777" }
    }
  }
}
```

## Usage

Launch any Claude Code session with the channel enabled:

```bash
claude --dangerously-load-development-channels plugin:ccc-hub@rophy-plugins
# or, if you registered via ~/.claude.json:
claude --dangerously-load-development-channels server:ccc-hub
```

The `--dangerously-load-development-channels` flag is required during the channels research preview until ccc-hub is on the approved allowlist.

On startup, the channel registers with the daemon and reports its assigned name to stderr:

```
[ccc-hub-channel] registered as: my-project
```

### Tools exposed to Claude

- **`list_sessions`** — returns the names of all sessions currently connected.
- **`send_message(to, text, in_reply_to?)`** — sends a message to another session. Pass `in_reply_to` with a prior message's id to thread replies.

### Inbound messages

Messages from peer sessions arrive in the receiving Claude's context as:

```
<channel source="ccc-hub" from="peer-name" message_id="uuid" in_reply_to="optional-uuid">
message body
</channel>
```

## Session naming

By default, a session's name is `basename(cwd)`. If that collides with an already-registered session, the daemon appends a short random suffix and returns the assigned name.

Override with an environment variable:

```bash
CCC_SESSION_NAME=backend-api claude --dangerously-load-development-channels server:ccc-hub
```

## Environment variables

| Variable | Component | Default | Description |
|---|---|---|---|
| `PORT` | daemon | `7777` | Port to listen on inside the container |
| `CCC_HUB_URL` | channel | `ws://127.0.0.1:7777` | Hub WebSocket URL |
| `CCC_SESSION_NAME` | channel | `basename(cwd)` | Override session name |

## Protocol

JSON-RPC 2.0 over WebSocket. Methods are client-initiated; the `deliver` notification is server-pushed.

| Method | Params | Result |
|---|---|---|
| `register` | `{name}` | `{assigned_name}` |
| `list_sessions` | `{}` | `{sessions: string[]}` |
| `send_message` | `{to, text, in_reply_to?}` | `{message_id}` |

| Notification | Params |
|---|---|
| `deliver` | `{from, text, message_id, in_reply_to?}` |

Error codes:
- `-32001` session not found
- `-32002` not registered
- `-32003` already registered

## Design decisions

- **No offline delivery.** If the target session isn't connected, `send_message` returns an error. If the daemon isn't running, the channel fails at startup.
- **No presence push.** Sessions don't receive join/leave events; call `list_sessions` on demand.
- **Localhost-only trust.** The daemon binds to `127.0.0.1` and trusts any local connection. Do not expose the port externally.
- **Peer messages are untrusted input.** Another session's text is treated as a user-like request, not as instructions to Claude.

## Development

```bash
npm install
npm run dev:daemon      # run daemon via tsx (no docker)
npm run dev:channel     # run channel standalone (useful for debugging)
npm run build           # compile to dist/
npm run build:plugin    # bundle channel into plugin/channel.js (committed)
```

After changing channel code, run `npm run build:plugin` to refresh the committed bundle before publishing a new plugin version.

## License

MIT
