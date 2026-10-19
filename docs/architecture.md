# Architecture

Status: scaffold. Content is written from evidence in Phase 0 and finalized in Phase 2.
Source of truth: `PRD.md` §9, §10, §11, §15.

## Process model

[Ratified by S2, Task 0.6 — replace with: Notification Host lifecycle, shim budget,
pipe name, single-instance mechanism, spool fallback, measured latencies.]

## Components

| Component | Package | Responsibility |
|---|---|---|
| Adapters | `adapters/*` | host discovery + signal normalization only |
| Contract | `packages/contract` | AgentEvent schema, IPC schema, config schema, safe names |
| Core | `packages/core` | ordering, state machine, dedupe, policy, templates, pipeline (pure) |
| Storage | `packages/storage` | SQLite schema + repositories (host-only) |
| Notifications | `packages/notifications` | provider interfaces, audio queue, dispatch |
| Platform Windows | `packages/platform-windows` | sound/TTS/toast/focus implementations |
| Host | `packages/host` | pipe server, lifecycle, timers, spool ingest, doctor |
| Shim | `packages/shim` | bounded pipe client + spawn + spool |
| CLI | `packages/cli` | status/history/preview/doctor/config/mute/install |

## Paths

- Config: `%APPDATA%\AgentAttention\config.json` (D-05)
- Data: `%LOCALAPPDATA%\AgentAttention\` (database, spool, logs, install manifests)
- Pipe: `\\.\pipe\agent-attention-<user>` (D-03)

## Data flow

```text
host signal -> adapter -> shim -> pipe -> host -> core pipeline -> providers
                                         |-> SQLite (single writer)
```

## Test mapping (filled in Task 4.15)

[F4–F15 acceptance criteria -> test files table]
