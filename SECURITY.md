# Security

_Last updated: 2026-04-18_

This document describes the trust model and known attack surface of the `peer-channel` plugin. For a privacy-focused summary (no network, no telemetry, no retention), see [PRIVACY.md](PRIVACY.md).

## Trust model

**Same-user, local-only.** The plugin trusts every process running as the same OS user on the same machine. It does not authenticate peers beyond OS file permissions.

- Sockets and lockfiles live in `~/.peer-channel/sessions/` (directory mode `0700`, socket mode `0600`).
- Only processes running as the user that owns `$HOME` can connect.
- No network exposure. No TCP, no HTTP, no DNS, no outbound connections.

If every process running as your user is trusted, the channel is safe. If any process running as your user is malicious or compromised, it can fully participate in the channel.

### Host-level peers

Sessions can opt in to host-level exposure, making them discoverable by sessions running as any Linux user on the same machine.

- Host-level sockets live in `/run/peer-channel/{username}/` (directory mode `1777`, socket mode `0666`).
- Any local user can connect to a host-level socket and send messages.
- The sender's OS identity (`peer_user`, `peer_uid`) is included in notifications — derived from the socket path namespace, not self-asserted.
- The `from` field remains self-asserted (same as user-level).
- Prompt injection risk is higher for host-level peers because the sender may be a different, less-trusted user.

Host-level sessions are opt-in only (`PEER_CHANNEL_HOST_LEVEL=true`). Default behavior is unchanged.

| | User-level (default) | Host-level (opt-in) |
|---|---|---|
| Socket location | `~/.peer-channel/sessions/` | `/run/peer-channel/{username}/` |
| Permissions | `0700` dir, `0600` socket | `1777` dir, `0666` socket |
| Reachable by | same OS user | any local user |
| Sender identity | self-asserted `from` only | `from` (self-asserted) + `peer_user`/`peer_uid` (OS-derived) |

## Attack surface

- **The AF_UNIX socket at `~/.peer-channel/sessions/<name>.sock`.** Accepts NDJSON JSON-RPC 2.0 requests; validated with Zod schemas. Malformed payloads are rejected with standard JSON-RPC errors and not forwarded to Claude.
- **The MCP notification channel to Claude.** Valid `deliver` RPCs are forwarded as `<channel source="…" from="…" message_id="…">body</channel>` blocks in the receiving Claude's context.
- **The `send_message` MCP tool.** Lets the receiving Claude send arbitrary text to any reachable peer name.
- **Filesystem state under `~/.peer-channel/`.** Lockfile directories, socket inodes, and (via `proper-lockfile`) PID metadata written to disk.

## In scope (defended against)

- **Cross-user access (user-level sessions).** Enforced by the OS via the `0700` directory and `0600` socket permissions the plugin sets.
- **Malformed payloads.** Schema-validated; rejected without reaching Claude.
- **Clearly labelled untrusted input.** Peer messages arrive wrapped in a `<channel>` element, and the MCP server instructs Claude to treat them as untrusted peer input rather than instructions.
- **Host-level identity verification.** For host-level peers, the sender's OS user and uid are derived from the connecting socket's path namespace (`/run/peer-channel/{username}/`), not taken from a self-asserted field, and included in notifications alongside the self-asserted `from`.

## Out of scope (known non-goals)

The following attacks are **not** defended against. Users should understand them before relying on the plugin.

### Malicious local code running as your user

Any process running as your user — a compromised npm dependency, a shell hook, a rogue MCP server, an untrusted plugin — can:
- Connect directly to any session's socket and send arbitrary `deliver` RPCs.
- Acquire any unclaimed lockfile and impersonate a fresh session name.
- Read and modify any file under `~/.peer-channel/`.

No allowlist, pairing mechanism, or config file stored under the same user's home directory can meaningfully defend against this, because an attacker with that level of access can edit any such config.

### Sender identity spoofing

The `from` field in a `deliver` RPC is self-asserted by the sender. The plugin does **not** verify that the connecting process actually holds the lockfile for the claimed name. A cooperating peer can set `from` to any string, including the name of another live session.

### Prompt injection via peer messages

Inbound peer messages become text in the receiving Claude session's context. A peer can attempt to steer Claude by embedding instructions in the message body. The MCP server tells Claude to treat these as untrusted user requests, but this is advisory; it relies on the model's adherence to the instruction and is not technically enforced.

### Observation of in-flight messages

Message bodies are not encrypted. While in transit they live in kernel socket buffers; while stored transiently they may be observable via `/proc` or filesystem access by other processes running as your user.

## Mitigations implemented

- File permissions: `~/.peer-channel/sessions/` is `0700`, sockets are `0600`.
- Host-level socket permissions: `/run/peer-channel/{username}/` is `1777`, sockets are `0666` — required for cross-user reachability, opt-in only, and paired with OS-derived sender identity rather than trusting a self-asserted field.
- Protocol validation: Zod schemas reject malformed JSON-RPC before any handler runs.
- Labelled untrusted input: peer messages are delivered inside `<channel>` blocks, with system instructions telling Claude they are untrusted.
- No persistent storage of message bodies.
- No network binding, at all.

## Reporting security issues

Please open an issue at https://github.com/rophy/claude-peer-channel/issues. Do not post working exploit details in a public issue; if the report is sensitive, open a minimal issue asking for a private contact channel.
