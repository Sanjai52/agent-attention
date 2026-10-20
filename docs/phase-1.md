# Phase 1 — Contract and Core: Implementation Report

**Status: COMPLETE and MERGED** via PR #1 (`phase 1: contract and core`),
merge commit `92bae16` on `main`.

| Item | Value |
|---|---|
| Plan | [`plans/02-phase-1-contract-and-core.md`](plans/02-phase-1-contract-and-core.md) |
| Branch | `phase-1-contract-and-core`, merged and deleted |
| Tasks | 1.1–1.18 complete |
| Implementation commits | `8c0239f` … `3aa13b3` (17 task commits), plus the volume-independence test and docs commits |
| Gate | `npm run ci` green: lint, dependency check, typecheck, **310 tests / 19 files**, build |
| Exit criteria | Pure core complete; synthetic replay passes; PRD §19.1 core areas covered; docs written |
| Merge | PR #1 merged with a merge commit (`92bae16`) after explicit confirmation |

## 1. Outcome

Phase 1 delivers the part of the product that does not depend on a host:

- a strict, versioned `AgentEvent` contract and adapter capability declaration;
- the PRD §8.3 configuration schema with per-key fallback;
- a pure core for ordering, session state, deduplication, quiet hours, turn-end
  precedence, rate limiting/coalescing, reminders, staleness, and templates;
- a single `processEvent` pipeline that composes those pieces and returns
  notification plans and timer instructions;
- a deterministic fixture format and replay harness for future adapters;
- documentation for the contract, architecture, and both completed/parked
  phases.

Nothing in `packages/core` performs I/O, opens a database, reads the clock,
schedules a timer, plays audio, shows a toast, or calls Windows. The purity test
enforces that boundary.

## 2. Package layout

### `packages/contract`

| File | Contents |
|---|---|
| `events.ts` | 11 event types, `AgentEvent`, detail enums, `SUMMARY_CODES` |
| `event-schema.ts` | Strict zod schema, required details per type, structured validation issues |
| `capabilities.ts` | `AdapterCapabilities`, `SupportLevel`, adapter lifecycle interface |
| `config.ts` | Config schema v2, verbatim PRD defaults, per-key fallback, diagnostics |
| `safe-name.ts` | Control/bidi stripping, truncation, voice allowlist, short session IDs |
| `summary.ts` | Enumerated summary codes (no free text) |
| `versions.ts` | Event schema `1`, config schema `2` |

### `packages/core`

| Module | Contents |
|---|---|
| `state/session.ts` | `SessionRecord`, pending requests, tasks, state/confidence types |
| `state/transitions.ts` | Pure `applyEvent`, request open/close, task/subagent scope, resumable terminals |
| `ordering.ts` | `compareEvents`, `isLateEvent`, trustworthy-time rule |
| `dedupe/fingerprint.ts` | Three fingerprint rules, time buckets, adjacent bucket |
| `policy/quiet-hours.ts` | Wall-clock minutes, cross-midnight, per-channel suppression |
| `presentation/templates.ts` | Controlled title/body/speech, privacy modes, safe fallbacks |
| `attention/turn-end.ts` | Min-duration and subagent precedence |
| `attention/rate-limit.ts` | Rolling 60 s audible window, priority, 30 s bypass |
| `attention/coalesce.ts` | Same-window grouping and summary requirement |
| `attention/reminders.ts` | Reminder due-time and max-reminder planning |
| `staleness.ts` | Working/waiting staleness and restart reconciliation |
| `pipeline/types.ts` | `PipelineStore`, `Clock`, dependencies, plans, timers, diagnostics |
| `pipeline/process-event.ts` | The composition entry point |

### Tests

| Area | Files |
|---|---|
| Contract | `tests/unit/contract/` (schema, config, safe names, versions, types) |
| Core behavior | `tests/unit/core/` (state, ordering, dedupe, quiet hours, templates, turn-end, rate limit, coalesce, reminders, staleness) |
| Composition | `tests/unit/core/pipeline.test.ts` |
| Replay | `tests/unit/core/replay.test.ts`, `tests/helpers/fixtures.ts` |
| Purity | `tests/unit/tooling/purity.test.ts` |

## 3. Task-by-task delivery

| Task | Commit | Delivered |
|---|---|---|
| 1.1 Tooling baseline | `8c0239f` | Workspace scripts, ESLint, CI purity/dependency checks |
| 1.2 Event and capability types | `e6a5e0f` | `AgentEvent`, 11 types, capability declaration, summary codes |
| 1.4 Safe names | `cdfcd71` | Control/bidi stripping, 64-code-point limit, voice allowlist, short IDs |
| 1.3 Strict event validation | `32492dc` | Zod 4 schema, required details, structured issues, synthetic `dedupeKey` rule |
| 1.5 Config schema | `aaf9e59` | Schema v2, verbatim defaults, per-key fallback, unknown-key diagnostics |
| 1.7 Session state machine | `eaf9bb1` | `applyEvent`, pending requests, terminal resume, denial, confidence |
| 1.6 Ordering and lateness | `ba144c7` | Sequence → trustworthy time → receipt → eventId; closing-event exemption |
| 1.8 Task/subagent semantics | `5938140` | Task records, completion scope, `affectsParent`, unknown-parent independence |
| 1.9 Dedupe fingerprints | `e0fb50d` | Source ID, adapter key, composite bucket + adjacent bucket, progress null |
| 1.10 Quiet hours | `6767146` | `HH:MM` parsing, cross-midnight half-open interval, per-channel flags |
| 1.11 Templates and privacy | `3012b4c` | Exact PRD wording, discreet mode, speech sanitization, fallbacks |
| 1.12 Turn-end precedence | `e5862d2` | Grace supersession, min duration, subagent suppression |
| 1.13 Rate limit and coalescing | `f34abd5` | 60 s audible window, priority order, 30 s bypass per class, grouping |
| 1.14 Reminders | `3803b93` | Due-time arithmetic, max reminders, disabled/resolved handling |
| 1.15 Staleness | `5865c2c` | Working/waiting evaluation, closed requests, restart reconciliation |
| 1.16 Event pipeline | `9b99da0` | `processEvent`, capability enforcement, suppressors, plans, timers, coalesced summary |
| 1.17 Fixtures and replay | `3aa13b3` | JSONL meta/event/expected format, loader, deterministic replay, synthetic session |
| 1.18 Exit verification | docs commit | Full gate, §19.1 audit, RF1–RF5 sweep, contract/architecture docs, master-plan checkbox |

### 3.1 Contract highlights

- **Strictness:** every object is strict; unknown keys are rejected. Events
  carry no free text. `details` keys are enumerated.
- **Required details:** `approval_resolved.resolution`, `resumed.resumeReason`,
  `completed.completionScope`, `failed.failureCode`. Synthetic events must carry
  a `dedupeKey`.
- **Versioning:** event `schemaVersion: 1`, config `schemaVersion: 2`. An
  unsupported version is rejected (events) or returns defaults with a diagnostic
  (config).
- **Failure codes:** `unsupported_version`, `unsupported_type`,
  `missing_details`, `schema`, `invalid_field`. `parseAgentEvent` never throws.
- **Config fallback:** each leaf is validated independently. Invalid values fall
  back only for that key; unknown keys are reported and stripped; missing keys
  take defaults silently.
- **Safe names:** unsafe control/bidi characters are rejected at validation and
  stripped again at presentation; display names are capped at 64 code points and
  voice uses a strict allowlist. Session IDs shown to users are SHA-256 prefixes.

### 3.2 State and ordering

`SessionRecord` is storage-agnostic and keyed by `(adapterId, sessionId)`. It
tracks state, confidence, last event/seen times, accepted sequence, pending
requests, tasks, agent/project identity, and subagent parentage. Transitions
clone the record. Approval resolution and input resumption close the matching
request and return the session to `working`; a late closing event is allowed to
close its request but never notifies.

Ordering is per session stream: `sequence`, then trustworthy `occurredAt`, then
`receivedAt`, then `eventId`. `occurredAt === receivedAt` is treated as a copied
timestamp, not source time. Progress is liveness only: never fingerprinted,
never stored, but it refreshes `lastSeenAt` even when older.

### 3.3 Deduplication

Three ordered rules produce SHA-256 fingerprints:

1. source-stable `eventId`;
2. adapter `dedupeKey`;
3. composite of adapter/session/task/event/request plus a time bucket.

Rule 3 also checks the previous bucket so a boundary split cannot double-alert.
Progress returns `null`. A malformed time or unusable window also returns `null`;
the pipeline rejects non-progress events it cannot fingerprint rather than
dropping dedupe protection. Claims happen before any record or state mutation;
duplicates stop with empty plans/timers.

### 3.4 Policy and attention

- Quiet hours are pure wall-clock minutes; cross-midnight windows are half-open
  and DST-safe by construction (no `Date` math).
- Turn-end is always inferred. `minTurnSeconds` suppresses short turns; a
  classified event inside the grace window supersedes the pending turn-end.
- The audible rate limiter is a rolling 60 s window of 6 admissions. New
  input/approval requests get a 30 s-per-class bypass, including when the window
  is full. Desktop is never rate limited.
- Coalescing groups same-window alerts and requires a summary. The pipeline also
  emits a `<eventId>:coalesced` plan when an audible alert is rate limited; the
  host merges same-window summaries.
- Reminders and staleness return timer instructions only; the host owns timers.
- Focus awareness is intentionally absent because Q-06 is still open.

### 3.5 Pipeline

Order: validate → capability check → claim fingerprint → record event → order
check → apply state → supersede grace → policy/suppressors → plans/timers.

Statuses: `processed`, `duplicate`, `late`, `rejected`. Rejections and
duplicates never mutate state. Persistence precedes dispatch, so a failed
notification cannot erase the event. The pipeline catches unexpected errors and
returns a diagnostic instead of crashing the host.

Suppressor precedence is fixed: disabled class → cancelled failure → known
subagent → short turn → channel toggles → global mute → quiet hours → rate
limit. The first reason wins. The `grace` map is host-owned state passed in
explicitly, so the core remains deterministic.

### 3.6 Fixture replay

The JSONL format is frozen in `tests/fixtures/README.md`:

1. one `meta` line;
2. `{"kind":"event","event":{…}}` lines;
3. optional `{"kind":"expected",…}` snapshots.

The loader validates each event with `parseAgentEvent`, reports line numbers, and
refuses a stream without meta or events. Replay drives the real pipeline, checks
final state/confidence, and returns plans/statuses. Replaying the same stream
against the same store produces no second notifications.

### 3.7 Exit verification

- `npm run ci` from the branch: **green**.
- 310 tests in 19 files.
- Synthetic replay: `started → progress → needs_input → resumed → completed`
  ends `completed/authoritative` with no pending requests.
- PRD §19.1 core areas audited; two non-core areas deferred with owners (see
  §6). Volume independence gained an explicit config test.
- RF1–RF5 tests confirmed and listed in
  [`event-contract.md`](event-contract.md#11-review-focus-evidence).
- `docs/event-contract.md` populated; `docs/architecture.md` core map written;
  master-plan Phase 1 checked.

## 4. Interface decisions and deviations

| Decision | Why | Where recorded |
|---|---|---|
| Task 1.4 before 1.3 | Safe-name helpers are used by the schema | Ledger |
| Task 1.7 before 1.6 | Ordering consumes `SessionRecord` | Ledger |
| `applyEvent(..., capabilities?)` | Task scope honesty without forcing capabilities in pure tests | `state/transitions.ts` |
| `StateTransition.affectsParent` | Parent notification depends on known subagent parent | `state/transitions.ts` |
| `StateTransition.closedRequest` | Pipeline/host need the resolved request | `state/transitions.ts` |
| `isLateEvent(..., session)` takes pending requests | Closing-event exemption needs the open request list | `ordering.ts` |
| `evaluateStaleness` returns `closedRequests` | Host must close stale requests, not just report state | `staleness.ts` |
| `planReminderTimers` accepts `PendingRequest \| undefined` | Pipeline calls it before checking existence | `attention/reminders.ts` |
| Rate-limit bypass quiet period fixed at 30 s | PRD says “after a quiet period” without a value | `attention/rate-limit.ts` |
| `waitingAfterHours` is an explicit staleness parameter | It is not in the PRD §8.3 config JSON (marked Proposed) | `staleness.ts` |
| Disabled event class returns no plan | No channels are planned at all; history still records | `pipeline/process-event.ts` |
| Grace map is passed in, not hidden module state | Keeps the core deterministic and testable | `pipeline/types.ts` |
| Per-task reviewer subagents skipped | User asked for continuous execution and phase-end checks | Master plan workflow |
| No focus suppressor yet | Q-06/Q-07 are open; inventing one would be a false capability | Pipeline header comment |

## 5. Verification evidence

### Full gate

```text
npm run lint        -> pass
npm run deps:check  -> no depcheck issue
npm run typecheck   -> root + 11 workspaces pass
npm run test        -> 19 files, 310 tests pass
npm run build       -> all workspaces build
```

### Suite breakdown

| Suite | Tests |
|---|---:|
| `contract/versions` | 2 |
| `contract/safe-name` | 13 |
| `contract/types` | 4 |
| `contract/event-schema` | 16 |
| `contract/config` | 13 |
| `core/fingerprint` | 19 |
| `core/ordering` | 16 |
| `core/reminders` | 12 |
| `core/quiet-hours` | 28 |
| `core/coalesce` | 8 |
| `core/rate-limit` | 12 |
| `core/turn-end` | 14 |
| `core/staleness` | 24 |
| `core/state-tasks-subagents` | 19 |
| `core/templates` | 29 |
| `core/state-transitions` | 38 |
| `core/pipeline` | 36 |
| `core/replay` | 5 |
| `tooling/purity` | 2 |
| **Total** | **310** |

### PRD §19.1 coverage

| Area | Status | Evidence / owner |
|---|---|---|
| Schema validation, unknown versions, missing details | Covered | `event-schema.test.ts` |
| Normalization | Covered for Phase 1 | Normalized `SessionRecord`, safe-name normalization; adapter payload normalization is Phase 3 |
| Ordering (sequence, time, receipt, late) | Covered | `ordering.test.ts` |
| State transitions, resumable terminals, denial | Covered | `state-transitions.test.ts` |
| Task vs session completion | Covered | `state-tasks-subagents.test.ts` |
| Subagents | Covered | `state-tasks-subagents.test.ts`, `pipeline.test.ts` |
| Fingerprints (three rules, null, adjacent) | Covered | `fingerprint.test.ts` |
| Quiet hours (cross-midnight, boundaries) | Covered | `quiet-hours.test.ts`; DST integration deferred to 4.8 |
| Global mute | Covered | `pipeline.test.ts` |
| Effective-policy resolution | Covered | `pipeline.test.ts` |
| Volume independence | Covered at config layer | `config.test.ts`; runtime application is Phase 2 |
| Templates and privacy | Covered | `templates.test.ts`, `pipeline.test.ts` |
| Safe names | Covered | `safe-name.test.ts`, `templates.test.ts` |
| Staleness | Covered | `staleness.test.ts` |
| Turn-end grace and min duration | Covered | `turn-end.test.ts`, `pipeline.test.ts` |
| Rate limit, coalescing, queue priority | Covered | `rate-limit.test.ts`, `coalesce.test.ts`, `pipeline.test.ts`; queue execution is Phase 2 |
| Reminders | Covered | `reminders.test.ts` |
| Config validation and per-key fallback | Covered | `config.test.ts` |

### Review Focus sweep

- **RF1** hostile names: safe-name, templates, pipeline.
- **RF2** duplicates/out-of-order: fingerprints, pipeline, replay.
- **RF3** time: ordering, quiet hours, pipeline.
- **RF4** restart/staleness: staleness reconciliation tests.
- **RF5** capability honesty: pipeline rejection tests.

## 6. Known gaps and deferrals

| Gap | Why it is not Phase 1 | Owner |
|---|---|---|
| Focus/Do-Not-Disturb and click-to-focus | Q-06/Q-07 unresolved; Phase 0 S3 | Phase 2/4 (F13) |
| Ended-session ID reuse policy | Host lifecycle decision | Phase 2 |
| `waitingAfterHours` config key | Not in PRD §8.3; marked Proposed | Phase 4 |
| IPC envelope, pipe framing, error codes | Needs D-03 process model | Phase 2 Task 2.3 |
| Audio queue, volume application, toast/AUMID, TTS | Windows provider work | Phase 2 |
| Real-host fixtures and payload normalization | Blocked on D-01 | Phase 3 |
| DST/cross-midnight integration under a fake clock | Integration-level test | Phase 4 Task 4.8 |
| Queue priority execution | Core publishes priorities; host executes | Phase 2 |
| Phase 0 evidence (S1–S3) | S1 OpenCode documentation done; S1 probe and S2/S3 pending | Phase 0 |
| Config writer preserving unknown keys | Writer is a host concern | Phase 4 |

Additional assumptions Phase 2 must honor:

- A `PipelineStore` implementation must make `claimFingerprint` transactional
  with event recording and state save, or duplicate/restart behavior will drift.
- The host must supply `quietHoursMinutes` computed from the host's local
  timezone at the event time, not the machine's current timezone.
- The host must pass an `AdapterCapabilities` declaration in production; without
  it, capability enforcement is skipped.
- `agent.needs_input` without `requestId` uses `eventId` as the request identity;
  adapters with unstable event IDs must supply `requestId` to make resolution
  reliable.
- Turn-end alerts are delayed by the host using the `grace` timer; the pipeline
  only registers the pending entry and removes it on a classified event.

## 7. How to verify locally

```bash
git checkout main
npm ci
npm run ci
npx vitest run tests/unit/core/replay.test.ts
```

Inspect the public surface in `packages/core/src/index.ts`, the contract in
`packages/contract/src/index.ts`, and the semantics in
[`event-contract.md`](event-contract.md).

## 8. Handoff to Phase 2

Phase 2 can build against:

- `PipelineDependencies` (`store`, `config`, `capabilities`, `clock`,
  `rateLimiter`, `quietHoursMinutes`, `formatTimeLabel`, `grace`);
- `PipelineStore` (claim, record, load/save session, diagnostics);
- `ProcessingResult` (`status`, `planned`, `timers`, `diagnostics`, `session`);
- `PlannedNotification` channels and `SuppressionReason`;
- `TimerInstruction` (`grace`, `stale`, `reminder`);
- `parseConfig`, `parseAgentEvent`, `AdapterCapabilities`;
- the fixture loader/replay harness for adapter tests.

The process model (D-03), SQLite binding (D-04), Windows delivery (Q-05), and
focus decisions (Q-06/Q-07) still need Phase 0 evidence. Phase 1 does not
pre-empt them.
