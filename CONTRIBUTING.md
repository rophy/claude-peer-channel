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

The repo itself is a plugin marketplace (`.claude-plugin/marketplace.json`), so Claude Code's plugin system can be pointed at the local path:

```
/plugin marketplace add /absolute/path/to/claude-peer-channel
/plugin install peer-channel@rophy-plugins
```

Then launch Claude Code the same way a user would:

```bash
claude --dangerously-load-development-channels plugin:peer-channel@rophy-plugins
```

This loads the committed `plugin/channel.js` bundle. After any code change, rebuild and refresh:

```bash
npm run build:plugin
```

then in Claude Code:

```
/plugin marketplace update rophy-plugins
```

and restart the session.

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

1. Bump version in all three places:
   - `package.json`
   - `src/channel/mcp.ts` (MCP server version)
   - `plugin/.claude-plugin/plugin.json` (marketplace version)
2. `npm run build:plugin` to refresh `plugin/channel.js`.
3. `npm test` to verify.
4. Commit the bundle alongside the version bump.
5. Tag and push.
