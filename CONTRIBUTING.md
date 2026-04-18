# Contributing

Development notes for working on `peer-channel` itself — running it from a source checkout, building, testing, and releasing.

## Requirements

- Node.js 20+
- Claude Code v2.1.80+ with claude.ai login
- Linux or macOS

## Setup

```bash
git clone https://github.com/rophy/claude-peer-channel.git
cd claude-peer-channel
npm install
```

## Scripts

```bash
npm run dev:channel     # run the channel standalone via tsx (useful for debugging)
npm run build           # compile TypeScript to dist/
npm run build:plugin    # bundle the channel into plugin/channel.js (committed)
npm test                # run the vitest suite
```

After changing channel code, run `npm run build:plugin` to refresh the committed bundle before publishing a new plugin version.

## Running from a local checkout

Instead of installing through the plugin marketplace, register the channel directly as an MCP server in `~/.claude.json`:

```json
{
  "mcpServers": {
    "peer-channel": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/claude-peer-channel/plugin/channel.js"]
    }
  }
}
```

Then launch Claude Code with:

```bash
claude --dangerously-load-development-channels server:peer-channel
```

When loaded this way, inbound messages arrive with `source="server:peer-channel"` instead of `source="plugin:peer-channel:peer-channel"`. The `from`, `message_id`, and `in_reply_to` attributes are stable across both modes.

## Repo layout

```
src/
├── channel/        # MCP server + socket server + peer RPC
│   ├── index.ts    # entry point: claim name, start listener, wire stdio
│   ├── mcp.ts      # MCP tool definitions and Claude-facing instructions
│   └── peer.ts     # lockfile, socket server, deliver RPC handling
└── shared/         # protocol, paths, session naming
plugin/
└── channel.js      # bundled output of build:plugin (committed)
```

## Release checklist

1. Bump version in `package.json`.
2. `npm run build:plugin` to refresh `plugin/channel.js`.
3. `npm test` to verify.
4. Commit the bundle alongside the version bump.
5. Tag and push.
