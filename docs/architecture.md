# Architecture

**Status:** Phase 1 (contract + pure core) implemented and verified. The process
model, storage binding, and Windows delivery mechanism remain **undecided**
until Phase 0 spikes close D-03/D-04/Q-05. This document records the
implemented core shape and the boundaries the later phases must preserve.
Source of truth: `PRD.md` §9, §10, §11, §14, §15.

## 1. Design boundaries

1. **The core is pure.** `packages/core` has no filesystem, database, network,
   timer, process, or Windows API calls. It receives storage, clock, rate
   limiter, and quiet-hours lookup through `PipelineDependencies`.
2. **The host owns effects.** Reading config, writing SQLite, scheduling
   timers, playing audio, speaking, showing toasts, and focusing windows all
   happen in Phase 2 packages. The core emits *instructions* and *plans*.
3. **Adapters normalize only.** An adapter translates host signals into
   `AgentEvent` and publishes `AdapterCapabilities`. It must not implement
   notification policy or wording.
4. **No free text crosses the contract.** Events carry enumerated fields and
   safe names. Templates produce all display and speech text.
5. **One writer for state.** Phase 2 gives the host a single SQLite writer;
   the core never opens the database.
6. **Capability honesty is enforced.** The pipeline rejects an event the
   adapter declared `unsupported`, an `authoritative` event for an `inferred`
   capability, and an `authoritative` `turn_ended`.

The purity rule is executable: `tests/unit/tooling/purity.test.ts` scans core
sources for forbidden imports and APIs.

## 2. Components

| Component | Package | Responsibility | Phase 1 state |
|---|---|---|---|
| Adapters | `adapters/*` | Host discovery and signal normalization only | Empty scaffolds |
| Contract | `packages/contract` | Event/config schemas, capabilities, safe names, versions | Implemented |
| Core | `packages/core` | Ordering, state, dedupe, policy, templates, pipeline | Implemented |
| Storage | `packages/storage` | SQLite schema and repositories (host-only) | Empty scaffold |
| Notifications | `packages/notifications` | Provider interfaces, audio queue, dispatch | Empty scaffold |
| Platform Windows | `packages/platform-windows` | Sound/TTS/toast/focus implementations | Empty scaffold |
| Host | `packages/host` | Pipe server, lifecycle, timers, spool ingest, doctor | Empty scaffold |
| Shim | `packages/shim` | Bounded pipe client, spawn, spool fallback | Empty scaffold |
| CLI | `packages/cli` | status/history/preview/doctor/config/mute/install | Empty scaffold |

## 3. Contract module map

| Module | Responsibility |
|---|---|
| `events.ts` | `AgentEvent`, 11 event types, detail enums, `SUMMARY_CODES` |
| `event-schema.ts` | Strict zod validation, required details, failure codes |
| `capabilities.ts` | `AdapterCapabilities`, support levels, adapter lifecycle |
| `config.ts` | Config schema v2, verbatim PRD defaults, per-key fallback |
| `safe-name.ts` | Control/bidi stripping, truncation, voice allowlist, short IDs |
| `summary.ts` | Enumerated summary codes (no free text) |
| `versions.ts` | Event schema `1`, config schema `2` |

## 4. Core module map

| Module | Responsibility |
|---|---|
| `state/session.ts` | Storage-agnostic `SessionRecord`, pending requests, task records |
| `state/transitions.ts` | Pure `applyEvent` state machine; request open/close; task/subagent scope; terminal resume |
| `ordering.ts` | `compareEvents`, `isLateEvent`, trustworthy-time rule |
| `dedupe/fingerprint.ts` | Three fingerprint rules, time buckets, adjacent-bucket check |
| `policy/quiet-hours.ts` | Wall-clock minutes, cross-midnight intervals, per-channel flags |
| `presentation/templates.ts` | Controlled title/body/speech templates, privacy modes, safe-name fallback |
| `attention/turn-end.ts` | Min-duration and subagent precedence for inferred turn ends |
| `attention/rate-limit.ts` | Rolling one-minute admission, priority constants, bypass |
| `attention/coalesce.ts` | Same-window grouping and summary requirement |
| `attention/reminders.ts` | Reminder due-time planning and max-reminder cap |
| `staleness.ts` | Working/waiting staleness, restart reconciliation |
| `pipeline/types.ts` | `PipelineStore`, clock, dependencies, plans, timers, diagnostics |
| `pipeline/process-event.ts` | Composition of all of the above; the only public entry point |

`packages/core/src/index.ts` re-exports the public surface.

## 5. Session state model

`SessionRecord` is keyed by `(adapterId, sessionId)` and stores:

- current `state` and `stateConfidence` (`authoritative`, `inferred`,
  `unverified`);
- `lastEventAt` (event time), `lastSeenAt` (receipt time), and
  `lastAcceptedSequence`;
- `pendingRequests` with kind (`input`/`approval`), request ID, open time, and
  reminder count;
- `tasks` keyed by task ID, plus completion scope evidence;
- `agentName`, optional project identity, `isSubagent` and
  `parentSessionId`.

States: `working`, `waiting_for_input`, `waiting_for_approval`, `idle`,
`completed`, `failed`, `ended`, `unknown`. Completion can be task-scoped or
session-scoped. A resolved approval or `resumed` input request returns the
session to `working`. Unknown parents are treated as independent sessions; a
subagent with a known parent affects the parent only through the completion
rules.

All transitions clone the record; the core never mutates the caller's session.

## 6. Pipeline

```text
unknown payload
  -> parseAgentEvent            reject: validation / capability
  -> capability honesty         reject: unsupported or dishonest confidence
  -> fingerprint claim          duplicate: stop, no state, no plans
  -> record event               (except progress)
  -> ordering / lateness        late: record, no state (closure may apply)
  -> applyEvent                 pure state transition + save
  -> grace supersession         classified event beats pending turn-end
  -> policy + suppressors       disabled -> subagent -> min turn -> mute
                                -> quiet hours -> rate limit
  -> plans + timer instructions return to host
```

Key invariants:

- **Persistence precedes dispatch.** The event is recorded and the session is
  saved before any notification plan is returned. A failed delivery cannot
  erase the event.
- **Duplicates stop early.** A failed fingerprint claim returns `duplicate`
  with no record, state change, plans, or timers.
- **Progress is liveness.** It is never fingerprinted or stored, but still
  refreshes `lastSeenAt` even when older.
- **Late closures are legal.** `approval_resolved`/`resumed` close their open
  request even when late; they never notify.
- **Timers are data.** `grace`, `stale`, and `reminder` instructions are
  returned to the host. The core never schedules or fires them.
- **Focus is absent.** Q-06 is open; no foreground-window check is invented.
- **Ended-session reuse is not decided.** The host lifecycle must choose
  reject-vs-reuse before persistence lands (PRD §13.2 last row).

## 7. Data flow (target)

```text
host signal -> adapter -> shim -> pipe -> host -> core pipeline -> providers
                                         |-> SQLite (single writer)
```

The left half is **not implemented**. Phase 1 covers everything from
`core pipeline` inward. The process model, pipe name, spool format, and
single-instance mechanism are pending S2/D-03.

## 8. Paths (pending)

- Config: `%APPDATA%\AgentAttention\config.json` (D-05)
- Data: `%LOCALAPPDATA%\AgentAttention\` (database, spool, logs, manifests)
- Pipe: `\\.\pipe\agent-attention-<user>` (D-03)

These are planning defaults, not ratified decisions. Do not ship install
scripts against them until Phase 0 closes.

## 9. Verification

Phase 1 gate: `npm run ci` (lint, dependency check, typecheck, 310 unit tests,
build) plus a full synthetic replay. Coverage by area:

| Area | Tests |
|---|---|
| Contract/schema/config/safe names | `tests/unit/contract/` |
| State machine, tasks, subagents | `tests/unit/core/state-*.test.ts` |
| Ordering, dedupe, staleness | `tests/unit/core/ordering.test.ts`, `fingerprint.test.ts`, `staleness.test.ts` |
| Policy/templates/attention | `tests/unit/core/quiet-hours.test.ts`, `templates.test.ts`, `turn-end.test.ts`, `rate-limit.test.ts`, `coalesce.test.ts`, `reminders.test.ts` |
| Composition | `tests/unit/core/pipeline.test.ts` |
| Fixture replay | `tests/unit/core/replay.test.ts` |
| Purity boundary | `tests/unit/tooling/purity.test.ts` |

Detailed contract semantics live in [`event-contract.md`](event-contract.md);
the Phase 1 delivery report is [`phase-1.md`](phase-1.md).

## 10. Open architecture decisions

| Decision | Owner | Consequence if changed |
|---|---|---|
| D-01 first host adapter | Phase 0 S1 | Adapter package/fixtures only; core unaffected |
| D-03 process model | Phase 0 S2 | Phase 2 host/shim/pipe wiring |
| D-04 SQLite binding | Phase 0 S2 | `packages/storage` implementation |
| Q-05 audio/TTS/toast mechanism | Phase 0 S3 | `platform-windows` providers |
| Q-06/Q-07 focus detection/click-to-focus | Phase 0 S3 | F13 suppressor and install flow |
| D-05 config/data paths | Phase 0/2 | Installer and docs |
