# Event Contract

**Status:** authoritative for Phase 1. Event schema **v1**, configuration schema
**v2**. The IPC protocol stays open until Phase 2 Task 2.3.
Source of truth: `PRD.md` §8, §12, §13, §14.4, §16.2, §17.3.

The contract is strict on purpose: an event carries **no free text from the
agent**. Notification wording comes only from controlled templates. Names are
attacker-influenceable and are sanitized at validation and again at
presentation.

## 1. Event types

| Event type | Default state | Required `details` | Notifiable | Notes |
|---|---|---|---|---|
| `agent.started` | `working` | — | No | Opens/refreshes a session record |
| `agent.progress` | `working` | — | No | Liveness only; never stored or fingerprinted |
| `agent.needs_input` | `waiting_for_input` | — | Yes | `requestId` falls back to `eventId` when absent |
| `agent.needs_approval` | `waiting_for_approval` | — | Yes | Must be resolved by request ID |
| `agent.approval_resolved` | `working` | `resolution` | No | Closes the matching approval request |
| `agent.resumed` | `working` | `resumeReason` | No | Closes the matching input request |
| `agent.turn_ended` | `idle` | — | Yes | Always `inferred`; `turnDurationMs` enables min-duration suppression |
| `agent.completed` | `completed` | `completionScope` | Yes | Scope is `task` or `session` |
| `agent.failed` | `failed` | `failureCode` | Yes | `cancelled` is silent by default |
| `agent.session_ended` | `ended` | — | No | Host session closed; history retained |
| `agent.state_unknown` | `unknown` | — | No | Adapter lost certainty |

Summary-like data is limited to the enumerated `summaryCode`:
`INPUT_REQUIRED`, `APPROVAL_REQUIRED`, `TURN_ENDED`, `TASK_COMPLETED`,
`SESSION_COMPLETED`, `FAILED`, `UNKNOWN`.

## 2. `AgentEvent` fields

| Field | Required | Constraint |
|---|---|---|
| `schemaVersion` | Yes | Literal `1`; any other value is `unsupported_version` |
| `eventId` | Yes | Non-empty string |
| `eventIdStability` | Yes | `source` or `synthetic` |
| `dedupeKey` | Required for `synthetic` | Non-empty string; used by dedupe rule 2 |
| `sequence` | No | Non-negative integer; ordering wins when both sides carry one |
| `eventType` | Yes | One of the 11 types above |
| `source.adapterId` | Yes | Non-empty string |
| `source.adapterVersion` | Yes | Non-empty string |
| `source.agentId` | Yes | Non-empty string |
| `source.agentName` | Yes | Safe name, at most 64 code points |
| `source.agentVersion` | No | Non-empty string |
| `session.sessionId` | Yes | Non-empty string |
| `session.parentSessionId` | No | Non-empty string; links subagents |
| `session.isSubagent` | No | Boolean |
| `session.taskId` | No | Non-empty string |
| `session.projectId` | No | Non-empty string |
| `session.projectName` | No | Safe name, at most 64 code points |
| `session.workingDirectory` | No | Non-empty string; evidence only, never executed |
| `occurredAt` | Yes | ISO 8601 with timezone |
| `receivedAt` | Yes | ISO 8601 with timezone |
| `confidence` | Yes | `authoritative` or `inferred` |
| `details` | Per type | Strict object; only the keys listed below |

Allowed `details` keys: `summaryCode`, `requestId`, `completionScope`,
`resolution`, `resumeReason`, `failureCode`, `turnDurationMs`. Every object is
strict: an unknown key fails validation rather than being stored.

`occurredAt === receivedAt` means the adapter merely copied receipt time. The
ordering and quiet-hours code treats that timestamp as **untrustworthy** and
uses `receivedAt` instead. When they differ, `occurredAt` is source time.

## 3. Worked examples

### Needs input

```json
{
  "schemaVersion": 1,
  "eventId": "evt-1001",
  "eventIdStability": "source",
  "eventType": "agent.needs_input",
  "source": {
    "adapterId": "opencode",
    "adapterVersion": "1.0.0",
    "agentId": "build",
    "agentName": "Build Agent"
  },
  "session": {
    "sessionId": "ses_123",
    "projectName": "agent-attention",
    "workingDirectory": "C:\\work\\agent-attention"
  },
  "sequence": 41,
  "occurredAt": "2026-10-20T10:15:03.120Z",
  "receivedAt": "2026-10-20T10:15:03.450Z",
  "confidence": "authoritative",
  "details": { "requestId": "req-7", "summaryCode": "INPUT_REQUIRED" }
}
```

### Needs approval

```json
{
  "schemaVersion": 1,
  "eventId": "evt-1002",
  "eventIdStability": "source",
  "eventType": "agent.needs_approval",
  "source": {
    "adapterId": "opencode",
    "adapterVersion": "1.0.0",
    "agentId": "build",
    "agentName": "Build Agent"
  },
  "session": { "sessionId": "ses_123", "projectName": "agent-attention" },
  "sequence": 42,
  "occurredAt": "2026-10-20T10:16:11.000Z",
  "receivedAt": "2026-10-20T10:16:11.210Z",
  "confidence": "authoritative",
  "details": { "requestId": "req-8", "summaryCode": "APPROVAL_REQUIRED" }
}
```

### Turn ended (always inferred)

```json
{
  "schemaVersion": 1,
  "eventId": "evt-1003",
  "eventIdStability": "source",
  "eventType": "agent.turn_ended",
  "source": {
    "adapterId": "opencode",
    "adapterVersion": "1.0.0",
    "agentId": "build",
    "agentName": "Build Agent"
  },
  "session": { "sessionId": "ses_123", "projectName": "agent-attention" },
  "sequence": 43,
  "occurredAt": "2026-10-20T10:17:00.000Z",
  "receivedAt": "2026-10-20T10:17:00.050Z",
  "confidence": "inferred",
  "details": { "turnDurationMs": 42000, "summaryCode": "TURN_ENDED" }
}
```

### Session completed

```json
{
  "schemaVersion": 1,
  "eventId": "evt-1004",
  "eventIdStability": "source",
  "eventType": "agent.completed",
  "source": {
    "adapterId": "opencode",
    "adapterVersion": "1.0.0",
    "agentId": "build",
    "agentName": "Build Agent"
  },
  "session": { "sessionId": "ses_123", "projectName": "agent-attention" },
  "sequence": 44,
  "occurredAt": "2026-10-20T10:18:30.000Z",
  "receivedAt": "2026-10-20T10:18:30.080Z",
  "confidence": "authoritative",
  "details": { "completionScope": "session", "summaryCode": "SESSION_COMPLETED" }
}
```

## 4. Validation and failure codes

`parseAgentEvent(input)` never throws. It returns either `{ ok: true, event }`
or `{ ok: false, errors: ValidationIssue[] }`.

| Code | Meaning |
|---|---|
| `unsupported_version` | `schemaVersion` is not `1`; the whole payload is rejected |
| `unsupported_type` | `eventType` is not one of the 11 contract types |
| `missing_details` | A type-specific required detail is absent |
| `schema` | Wrong JSON shape, missing base field, or unknown key |
| `invalid_field` | Value present but invalid (timestamp, enum, unsafe name) |

The pipeline records every issue as a diagnostic, returns `status:
"rejected"`, and **does not claim a fingerprint or persist anything**. This is
the “failed notification must never erase an event” guarantee: validation
happens before persistence, and persistence happens before dispatch.

## 5. Capability declaration and confidence honesty

Adapters publish `AdapterCapabilities` once at startup. The declaration is the
only place an adapter claims support; doctor, docs, and metrics read it.

| Field | Meaning |
|---|---|
| `adapterId`, `adapterVersion`, `hostVersionRange?` | Identity |
| `executionModel` | `in_process_plugin`, `hook_process`, or `extension` |
| `events` | Per-type `{ support, sourceSignal?, verifiedAgainst?, notes? }` |
| `eventIdsStable` | Source event IDs are stable enough for dedupe rule 1 |
| `supportsSequence` | Emits monotonic `sequence` |
| `supportsTaskScope` | Task-scoped completion is meaningful |
| `supportsSubagents` | Parent/child session links are available |
| `supportsLiveness` | Progress/heartbeat signals exist |
| `supportsResolutionSignals` | Approval/resume closures are observable |

Support levels are `authoritative`, `inferred`, and `unsupported`. The pipeline
enforces:

- `unsupported` event received → `rejected` with `capability_violation`.
- Capability `inferred` + event `confidence: authoritative` → `rejected`.
- `agent.turn_ended` with `authoritative` confidence → `rejected`; the event is
  an inference, not a fact.
- Capability checks are skipped only when no declaration is injected (Phase 1
  unit tests, pure-core embedding). Production wiring always supplies one.

## 6. Safe-name rules

Applied by `nameSchema` during validation and again by `sanitizeDisplayName`
before rendering or speech:

1. At most **64 Unicode code points** (truncation uses a single `…`).
2. Reject control characters `U+0000–U+001F`, `U+007F–U+009F`, and
   bidirectional overrides `U+202A–U+202E`, `U+2066–U+2069`.
3. Collapse whitespace, trim, and return `undefined` when nothing displayable
   remains.
4. Voice may use a name only when it matches `^[\p{L}\p{Nd} ._-]+$`.
5. Displayed session IDs are the first 8 hex characters of SHA-256, never the
   raw ID.
6. Names are never interpolated into shell commands, paths, URLs, or markup.

Templates re-sanitize and fall back to a constant (`"An agent"`, `"this
project"`) when a name is unusable. RF1 tests cover bidi names and
shell-looking project names.

## 7. Deduplication fingerprints

Fingerprint selection is ordered; each produces a SHA-256 over a pipe-delimited
identity:

1. **Source-stable ID:** `adapterId | sessionId | eventId` when
   `eventIdStability === "source"`.
2. **Adapter key:** `adapterId | sessionId | dedupeKey` when a `dedupeKey` is
   present.
3. **Composite:** `adapterId | sessionId | taskId | eventType | requestId |
   floor(occurredAt / fallbackWindowSeconds)`.

Rule 3 is time-windowed and returns both the current bucket (`primary`) and the
previous bucket (`adjacent`), because a source event can straddle a bucket
boundary. The store must claim the primary and, when present, the adjacent
fingerprint atomically. `agent.progress` returns `null` (never fingerprinted or
stored). A malformed `occurredAt` or unusable window also returns `null`; the
pipeline rejects non-progress events it cannot fingerprint instead of silently
dropping dedupe protection.

A duplicate stops immediately after the failed claim: no event record, no state
mutation, no plans, no timers. Diagnostics stay empty so replaying a stream does
not spam the host.

## 8. Ordering and lateness

Ordering is scoped to one `(adapterId, sessionId)` stream:

1. `sequence` when both events carry one.
2. Trustworthy `occurredAt` when both events carry trustworthy times.
3. `receivedAt` receipt order.
4. `eventId` as the final deterministic tiebreak.

An event older than the last accepted event is `late`: it is recorded with
`late: true` and changes no state. Exception: `agent.approval_resolved` and
`agent.resumed` for a still-open request are never discarded; they close the
request even when late. Late closures are recorded but never notify.
`agent.progress` is liveness, not state: an older heartbeat still refreshes
`lastSeenAt`.

## 9. Configuration contract

Configuration schema **v2** lives only in `%APPDATA%\AgentAttention\config.json`
(path pending D-05). Defaults are verbatim from PRD §8.3:

| Key group | Default |
|---|---|
| `globalMute` | `false` |
| `channels` | sound `true`, voice `false`, desktop `true` |
| `events.needsInput` | enabled; sound `attention` @ 35; voice off; desktop on |
| `events.needsApproval` | enabled; sound `approval` @ 45; voice off; desktop on |
| `events.turnEnded` | enabled; sound `idle` @ 25; desktop on; min 15 s; grace 1000 ms |
| `events.completed` | enabled; sound `complete` @ 25; desktop on |
| `events.failed` | enabled; sound `failure` @ 40; desktop on; `notifyOnCancelled: false` |
| `voice` | `voiceId: null`, volume 50, rate 0 |
| `quietHours` | disabled; 23:00–08:00; suppress sound/voice, not desktop |
| `focus` | enabled; `bypassForApproval: false` (detection pending Q-06) |
| `audio` | `maxQueueLength: 3` |
| `rateLimit` | 6 alerts/minute; 5 s coalesce window |
| `reminders` | disabled; after 10 min; max 1 |
| `privacy` | standard; show project name |
| `subagents` | `notify: false` |
| `deduplication` | `fallbackWindowSeconds: 30` |
| `stale` | `workingAfterMinutes: 15` |
| `activityHistory` | enabled; retention 7 days |

`parseConfig(raw)` walks every key independently:

- Missing key → its default, **no diagnostic**.
- Invalid value → that key's default, one `invalid_value` diagnostic with the
  rejected value's fallback.
- Unknown key → `unknown_key` diagnostic; the key is stripped from the returned
  object. (The writer preserves unknown keys separately; Phase 4.)
- Unsupported `schemaVersion` → all defaults plus one `unsupported_version`
  diagnostic. Migrations are forward-only.
- Non-object input → defaults plus one `invalid_value` diagnostic.

Volumes are independent per event class and channel: invalidating or changing
one leaves every other volume untouched (F4-R2).

`waitingAfterHours` (PRD §13.4, marked *Proposed*) is **not** in the config JSON
yet. `evaluateStaleness` accepts it as an explicit parameter (default 12);
Phase 4 must decide whether to expose it as a key.

## 10. Pipeline result contract

`processEvent(input, deps)` composes validation, capabilities, dedupe,
ordering, state transitions, policy, suppressors, and planning. It has no I/O
and executes no timer.

| Status | Meaning |
|---|---|
| `processed` | Recorded (unless progress) and applied; plans/timers may follow |
| `duplicate` | Fingerprint already claimed; nothing changed |
| `late` | Recorded with `late: true`; state changes only for a late closure |
| `rejected` | Validation, capability, or internal failure; diagnostics explain |

Suppressors run in this order, and the first reason wins:

1. Event class disabled (`disabled`)
2. Cancelled failure without `notifyOnCancelled` (`disabled`)
3. Known subagent completion/turn-end/failure (`subagent`)
4. Turn shorter than `minTurnSeconds` (`below_min_turn`)
5. Per-event and global channel toggles (`disabled`)
6. Global mute (`muted`)
7. Quiet hours (`quiet_hours`)
8. Rate limit (`rate_limit`), audible channels only

`agent.needs_input` and `agent.needs_approval` that open a **new** request
bypass the rate limit and the per-class cooldown; duplicate request IDs do not.
Desktop delivery is not rate-limited. When an audible alert is rate-limited,
the pipeline also emits one coalesced summary plan (`<eventId>:coalesced`) so
the host can merge same-window summaries; the original keeps its desktop toast.

Timer instructions are data only:

- `grace` — delay a turn-end alert; a classified event inside the window
  removes the pending entry and records a `state_conflict` diagnostic.
- `stale` — working session staleness after `workingAfterMinutes`.
- `reminder` — request reminder after `afterMinutes`.

Focus awareness is deliberately absent: Q-06 is open, so the core must not
invent a foreground-window check. Phase 2 adds it only after the spike decision.

## 11. Review Focus evidence

| Focus | Requirement | Tests |
|---|---|---|
| RF1 | Hostile names never reach UI/speech unsanitized | `tests/unit/contract/safe-name.test.ts`, `tests/unit/core/templates.test.ts`, `tests/unit/core/pipeline.test.ts` |
| RF2 | Duplicate delivery in a burst or after restart stays silent | `tests/unit/core/fingerprint.test.ts`, `tests/unit/core/pipeline.test.ts`, `tests/unit/core/replay.test.ts` |
| RF3 | Lateness, untrustworthy timestamps, quiet-hours boundaries | `tests/unit/core/ordering.test.ts`, `tests/unit/core/quiet-hours.test.ts`, `tests/unit/core/pipeline.test.ts` |
| RF4 | Restart/staleness reconciliation | `tests/unit/core/staleness.test.ts` |
| RF5 | Unsupported capability cannot be claimed | `tests/unit/core/pipeline.test.ts`, `tests/unit/contract/types.test.ts` |

## 12. Test map

| Suite | Contract area |
|---|---|
| `tests/unit/contract/event-schema.test.ts` | Shapes, types, required details, unsafe names |
| `tests/unit/contract/config.test.ts` | Defaults, per-key fallback, unknown keys, volume independence |
| `tests/unit/contract/safe-name.test.ts` | Sanitization, voice allowlist, short IDs |
| `tests/unit/contract/versions.test.ts` | Event/config version constants |
| `tests/unit/core/ordering.test.ts` | Sequence/time/receipt ordering and lateness |
| `tests/unit/core/fingerprint.test.ts` | All three rules, nulls, adjacent buckets |
| `tests/unit/core/state-transitions.test.ts` | State machine, requests, terminal resumes |
| `tests/unit/core/state-tasks-subagents.test.ts` | Task/session completion, subagent scoping |
| `tests/unit/core/pipeline.test.ts` | Composition, capability enforcement, suppressors, plans, timers |
| `tests/unit/core/replay.test.ts` | Synthetic fixture format and deterministic replay |

## 13. Not yet covered here

| Item | Owner |
|---|---|
| IPC message envelope, error codes, pipe framing | Phase 2 Task 2.3 |
| Adapter payload normalization and recorded host fixtures | Phase 3 (needs D-01) |
| Focus/Do-Not-Disturb detection and click-to-focus | Phase 2/4 (Q-06/Q-07) |
| Audio queue execution, volume application, toast/AUMID | Phase 2 |
| DST/cross-midnight integration under a fake clock | Phase 4 Task 4.8 |
| `waitingAfterHours` config exposure | Phase 4 |
| Ended-session ID reuse policy | Phase 2 host lifecycle |
