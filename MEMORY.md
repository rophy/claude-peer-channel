# MEMORY.md — context for a fresh Claude Code session

Hand-off notes. Updated 2026-04-16 after stage-2 design discussion.

## Project in one paragraph

`peer-channel` lets multiple Claude Code sessions talk to each other locally.
Each session runs a channel MCP subprocess exposing `list_sessions` and
`send_message(to, text, in_reply_to?)`. Peers receive
`notifications/claude/channel` which CC renders as
`<channel source="peer-channel" from="..." message_id="..." in_reply_to="...">body</channel>`.

Packaged as a Claude Code plugin via a self-hosted marketplace `rophy-plugins`.
Install: `/plugin marketplace add rophy/claude-peer-channel` then
`/plugin install peer-channel@rophy-plugins`. Channel bundle `plugin/channel.js`
is built from `src/channel/index.ts` via esbuild (CJS, node20, deps inlined)
and committed.

## Stage 1 — rename `ccc-hub` → `peer-channel`. DONE and PUSHED.

Commit `1054bed` on `main`, pushed 2026-04-16. GitHub repo is
`rophy/claude-peer-channel`. Package name, plugin name, env vars
(`PEER_CHANNEL_*`), bin names, Docker names all renamed. `plugin/channel.js`
rebuilt cleanly. Validators pass.

## Stage 2 — DESIGN SETTLED, IMPLEMENTATION NOT STARTED

Goal: remove Docker as a required dependency AND simplify the architecture
while we're at it. Design walked through with user on 2026-04-16.

**Final architecture: peer-to-peer, no hub daemon.**

- No central daemon process. The entire `src/daemon/` dir gets deleted.
- Each channel owns its own Unix socket at
  `~/.peer-channel/sessions/<name>.sock` plus lockfile `<name>.lock`
  alongside.
- Name claim via `proper-lockfile` (pure JS, bundles cleanly with esbuild).
  Default stale timeout ~10s is fine for this use case. Also write PID into
  the lockfile for debugging visibility, even though proper-lockfile doesn't
  consume it.
- Transport: raw `net` AF_UNIX sockets, NDJSON (newline-delimited JSON-RPC
  2.0), one-shot connections. No WebSocket, no `ws` dep.
- Two methods: `ping` (returns `{name, version}` — used by `list_sessions`
  for liveness) and `deliver` (one-way message delivery,
  `{from, text, in_reply_to?}` → `{message_id}`).
- `list_sessions` = readdir sessions dir, parallel ping with ~500ms timeout
  per peer, exclude self, exclude timeouts. Only clean up stale files when
  proper-lockfile confirms owner gone (lock acquisition succeeds where we
  expected contention); then unlink the `.sock` before re-creating ours.
- `send_message` = connect to `<to>.sock`, send `deliver`, close. Connection
  errors surface as MCP tool errors.
- Cleanup rule: owner's files are sacred while owner is alive.
  Ping-timeout-but-lock-alive means "maybe busy" → exclude from list,
  do NOT touch their files.

**Rejected alternatives, so we don't re-litigate:**

- Auto-spawn daemon on channel startup — rejected as hidden-process magic,
  lifecycle complexity, orphaned-process risk. The better answer turned out
  to be "no daemon at all."
- TCP + auto-spawn daemon — rejected once we realized Unix sockets + p2p
  eliminates the whole hub.
- `flock(2)` via native module (`fs-ext`) — rejected because esbuild can't
  bundle native modules, which would break the single-file plugin story.
  `proper-lockfile` is good enough.
- PID + start_time in lockfile — considered, but `proper-lockfile` is less
  code and battle-tested. Kept PID for debugging only.

**Gets deleted in stage 2:**

- `src/daemon/` (entire dir)
- `Dockerfile`, `docker-compose.yml`
- `ws` + `@types/ws` deps
- `peer-channel-daemon` bin in `package.json`
- Protocol file likely shrinks or restructures around `ping`/`deliver`

**Deferred:**

- Windows support (named pipes `\\.\pipe\peer-channel-<name>`). Design
  accommodates it, land Linux+macOS first.
- Any PID-reuse hardening beyond what `proper-lockfile` provides.

## User preferences learned this project

- **Terse output, no recap paragraphs.** Don't end every response with a
  summary.
- **Git policy** (from global CLAUDE.md): never push without instruction,
  never touch GitHub (issues/PRs/comments), never amend, no "Generated
  with Claude Code" or "Co-Authored-By" footer, no mention of "Claude" in
  commit messages, 1–5 line messages, conventional types
  (`feat|fix|refactor|chore|docs|build|test`).
- **Branding taste**: rejected "ccc-hub" (too abstract) and "local-channels"
  (ambiguous) before landing on "peer-channel". Repo name keeps the "claude"
  qualifier (`claude-peer-channel`) for discoverability; plugin name is
  just `peer-channel`.
- **Adoption-overhead sensitive**: actively reducing friction for new users
  is why stage 2 exists.
- **Pushes back on design decisions with good instincts.** Caught two
  mistakes during stage-2 discussion: "if PID alive but ping times out,
  don't delete their files" (correct — files are sacred while owner is
  alive) and "auto-spawn feels wrong" (correct — led to the much cleaner
  p2p design). Take concerns seriously, don't just defend the first sketch.

## Reminders, not memory

- Working end-to-end test was confirmed under old `ccc-hub` name with two CC
  sessions messaging each other. Post-rename revalidation not done yet —
  worth doing before publishing stage 2.
- Old agent-memory dir `~/.claude/projects/-home-rophy-projects-ccc-hub/memory/`
  is orphaned after the dir rename. Safe to delete.
