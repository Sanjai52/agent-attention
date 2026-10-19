# Phase 1 — Contract and Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the shared event contract, configuration schema, and the pure TypeScript core (ordering, state machine, dedupe, policy, templates, attention hygiene, pipeline) so that replayed fixture streams produce correct session states and notification decisions with zero duplicate processing.

**Architecture:** `packages/contract` holds Zod schemas, types, and constants only. `packages/core` is pure (no I/O, no timers, no OS calls): every policy decision is a function of (event, session state, config, clock inputs). The host supplies clock, persistence, and dispatch in Phase 2 behind interfaces defined here.

**Tech Stack:** TypeScript (strict, ESM), Zod, Vitest, npm workspaces. No runtime dependency from `core` on any agent SDK (PRD §10).

**Spec:** `PRD.md` §8, §12, §13, §14, §16.2, §17.2–17.3, §19.1.

## Global Constraints

- All defaults must match PRD §8.3 verbatim (see master plan Global Constraints).
- No free-text fields anywhere in the contract; wording only from PRD §14.3 templates.
- `core` and `contract` have zero I/O: no `fs`, no `process.exit`, no timers, no network, no OS calls. Enforce with a lint rule or a unit test scanning imports.
- Validation failures reject the event safely and produce diagnostics; they never throw past the pipeline boundary.
- Times: `occurredAt`/`receivedAt` are ISO 8601 with timezone. Quiet hours use local wall-clock minutes, never `Date` arithmetic across DST.
- Every task uses TDD: failing test first, then implementation, then commit.

## Review Focus

- **RF1 — Hostile agent-derived strings.** Owning tasks: 1.4 and 1.11 must pin control chars, bidi overrides, 64-char truncation, voice allowlist, and hostile quotes/semicolons; 1.16 must keep rejected events out of history.
- **RF2 — Duplicate/out-of-order delivery.** Owning tasks: 1.6 (late detection), 1.9 (fingerprints + adjacent bucket), 1.16 (duplicate stops before state mutation, persistence precedes dispatch).
- **RF3 — Time and clock oddities.** Owning tasks: 1.6 (untrustworthy timestamps), 1.9 (bucket boundaries), 1.10 (cross-midnight, DST, boundary inclusivity), 1.15 (stale waiting vs working).
- **RF4 — Windows unreliability does not exist in this phase**, but the pipeline must make provider outcomes additive-only; owning task 1.16 returns delivery plans, never performs them.
- **RF5 — Capability honesty.** Owning task 1.16: the core rejects an event type the adapter declared `unsupported`, and enforces `inferred` confidence for `inferred` declarations.

---

### Task 1.1: Complete the tooling baseline

**Files:**
- Modify: `package.json` (add `deps:check` script + `depcheck` devDependency)
- Create: `scripts/check-forbidden-imports.test.ts`? No — see Step 2: create `tests/unit/tooling/purity.test.ts`
- Modify: `.github/workflows/ci.yml` (add `npm run deps:check`)

**Interfaces:**
- Produces: a passing `npm run ci` gate that every later task must keep green; the purity test that guards `core`/`contract`.

- [ ] **Step 1: Write the failing purity test** `tests/unit/tooling/purity.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PURE_PACKAGES = ["packages/contract/src", "packages/core/src"];
const FORBIDDEN = [
  /from ["']node:fs["']/,
  /from ["']node:child_process["']/,
  /from ["']node:net["']/,
  /from ["']node:http["']/,
  /process\.exit/,
  /setTimeout\(/,
  /setInterval\(/,
];

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? collect(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("core and contract purity", () => {
  it.each(PURE_PACKAGES)("%s contains no I/O or timer calls", (pkg) => {
    const offenders = collect(pkg)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return FORBIDDEN.some((pattern) => pattern.test(source));
      });
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** (the `spikes/` exclusion and any accidental offenders should fail; before implementation this test may pass vacuously — if it passes because no files exist, the guard is still required by later tasks). Run: `npx vitest run tests/unit/tooling/purity.test.ts`. Expected: PASS or FAIL listing offenders; keep it green from now on.
- [ ] **Step 3: Add depcheck and CI wiring.** Add `"deps:check": "depcheck --ignores=@agent-attention/*,typescript,tsup,vitest,eslint,prettier,@eslint/js,typescript-eslint,@types/node,tsx"` to root scripts and `depcheck` to devDependencies; add `npm run deps:check` after `lint` in `.github/workflows/ci.yml`.
- [ ] **Step 4: Run** `npm install && npm run ci`. Expected: all steps pass.
- [ ] **Step 5: Commit** `chore: enforce purity and dependency hygiene in ci`.

---

### Task 1.2: Contract types and constants

**Files:**
- Create: `packages/contract/src/events.ts` (types), `packages/contract/src/capabilities.ts`, `packages/contract/src/summary.ts`
- Modify: `packages/contract/src/index.ts`
- Test: `tests/unit/contract/types.test.ts`

**Interfaces:**
- Produces (used by every later task, named exactly):
  - `AgentEventType`, `EventConfidence`, `CompletionScope`, `ApprovalResolution`, `ResumeReason`, `FailureCode`, `SummaryCode` (string unions, PRD §12.2)
  - `AgentEvent` interface with the exact fields of PRD §12.2 — `schemaVersion`, `eventId`, `eventIdStability`, `dedupeKey?`, `sequence?`, `eventType`, `source`, `session`, `occurredAt`, `receivedAt`, `confidence`, `details?`
  - `AgentEventDetails` (`summaryCode?`, `requestId?`, `completionScope?`, `resolution?`, `resumeReason?`, `failureCode?`, `turnDurationMs?`)
  - `SupportLevel`, `AdapterCapabilities`, `AgentAttentionAdapter` (PRD §16.2)

- [ ] **Step 1: Write a type-level test** with `expectTypeOf` proving `AgentEvent["details"]` is optional, `completionScope` is `"task" | "session"`, and `AgentEvent` has no index signature / extra free-text field:

```ts
expectTypeOf<AgentEvent["letter"]>().toBeNever();
```

(Use `@ts-expect-error` for fields that must not exist, e.g. `event.message`, plus a runtime test that `SUMMARY_CODES` enumerates exactly the seven codes.)

- [ ] **Step 2: Run it** `npx vitest run tests/unit/contract/types.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the types and a `SUMMARY_CODES` frozen array.**
- [ ] **Step 4: Run** the test and `npm run typecheck --workspace @agent-attention/contract`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): add agent event and capability types`.

---

### Task 1.3: Event validation schema

**Files:**
- Create: `packages/contract/src/event-schema.ts`
- Modify: `packages/contract/src/index.ts`
- Test: `tests/unit/contract/event-schema.test.ts`

**Interfaces:**
- Produces: `parseAgentEvent(input: unknown): EventParseResult` where `EventParseResult = { ok: true; event: AgentEvent } | { ok: false; errors: ValidationIssue[] }`; `ValidationIssue = { path: string; code: "schema" | "unsupported_version" | "unsupported_type" | "missing_details" | "invalid_field"; message: string }`.
- Consumes: Task 1.2 types; PRD §12.4 example.

- [ ] **Step 1: Write failing tests** covering, at minimum:
  - PRD §12.4 example parses `ok: true` and round-trips identical.
  - `schemaVersion: 2` → `unsupported_version` (PRD §12.3).
  - `eventType: "agent.exploded"` → `unsupported_type`.
  - `agent.completed` without `details.completionScope`, `agent.approval_resolved` without `resolution`, `agent.resumed` without `resumeReason`, `agent.failed` without `failureCode` → `missing_details` (PRD §12.3 required-details table).
  - Free text: `{ ...example, message: "hi" }` → rejected (strict object).
  - `eventIdStability: "synthetic"` without `dedupeKey` → `invalid_field` only when no `sequence`… (decide: require `dedupeKey` for synthetic turn_ended; pin as: synthetic events MUST supply `dedupeKey`).
  - Name fields longer than 64 chars and containing control chars → rejected at schema level (call Task 1.4 helpers from refinements).

- [ ] **Step 2: Run** `npx vitest run tests/unit/contract/event-schema.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** a strict Zod object with a discriminated union on `eventType` for the required-`details` variants (`completed`, `approval_resolved`, `resumed`, `failed`); map Zod issues to `ValidationIssue`; never throw.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): add strict agent event validation`.

---

### Task 1.4: Safe-name rules

**Files:**
- Create: `packages/contract/src/safe-name.ts`
- Test: `tests/unit/contract/safe-name.test.ts`

**Interfaces:**
- Produces:
  - `sanitizeDisplayName(value: string, maxLength?: number): string | undefined` — strips control + bidi-override characters, collapses whitespace, trims, truncates to `maxLength` (default 64) with `…`; returns `undefined` for empty results.
  - `isVoiceSafeName(value: string): boolean` — Unicode letters/digits/space plus `. _ -` only (PRD §17.3).
  - `shortSessionId(sessionId: string): string` — first 8 chars of a SHA-256 hex hash.

- [ ] **Step 1: Write failing tests (RF1):**

```ts
it("strips control and bidi characters", () => {
  expect(sanitizeDisplayName("pro\u202Eject\u0007")).toBe("project");
});
it("truncates to 64 chars with ellipsis", () => {
  expect(sanitizeDisplayName("x".repeat(80))).toHaveLength(64);
});
it("rejects shell metacharacters for voice", () => {
  expect(isVoiceSafeName('"; rm -rf ~ #')).toBe(false);
});
it("allows unicode letters in voice names", () => {
  expect(isVoiceSafeName("projëkt-über")).toBe(true);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/contract/safe-name.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** using code-point ranges for control (`\u0000-\u001F`, `\u007F-\u009F`) and bidi overrides (`\u202A-\u202E`, `\u2066-\u2069`).
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): add safe-name rules`.

---

### Task 1.5: Configuration schema, defaults, and per-key fallback

**Files:**
- Create: `packages/contract/src/config.ts`
- Test: `tests/unit/contract/config.test.ts`

**Interfaces:**
- Produces:
  - `AgentAttentionConfig` (exact shape of PRD §8.3, `schemaVersion: 2`).
  - `defaultConfig: AgentAttentionConfig` (values verbatim from §8.3).
  - `parseConfig(raw: unknown): ConfigParseResult` where `ConfigParseResult = { config: AgentAttentionConfig; diagnostics: ConfigDiagnostic[] }`, `ConfigDiagnostic = { keyPath: string; message: string; appliedFallback: unknown }`.
  - Per-key fallback: invalid scalar → default for that key with a diagnostic (PRD §8.1); unknown keys are preserved separately by the writer (Phase 4 Task 4.2), so `parseConfig` reports them in diagnostics as `unknown_key` and strips them.

- [ ] **Step 1: Write failing tests:**
  - `parseConfig(defaultConfig)` returns zero diagnostics and a deep-equal config.
  - `{ volume: 150 }` on `needsInput.sound` → falls back to 35, diagnostic path `events.needsInput.sound.volume`.
  - `soundId: "nope"` → falls back to `"attention"`, diagnostic.
  - `quietHours.startTime: "25:00"` → fallback `"23:00"`.
  - `schemaVersion: 1` → migrated or rejected per PRD §8.1 forward-only rule (pin: reject with diagnostic `unsupported_version` and return defaults).
  - A random unknown key `foo: 1` → diagnostic `unknown_key`, absent from result.
  - Times match `HH:mm` 24-hour exactly.

- [ ] **Step 2: Run** `npx vitest run tests/unit/contract/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with Zod, defaulting per key via `.catch()` on leaf schemas and a top-level `safeParse` walk that records which keys fell back.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): add config schema with per-key fallback`.

---

### Task 1.6: Event ordering and lateness

**Files:**
- Create: `packages/core/src/ordering.ts`
- Test: `tests/unit/core/ordering.test.ts`

**Interfaces:**
- Produces:
  - `compareEvents(a: AgentEvent, b: AgentEvent): number` — sequence (when both present) > trustworthy `occurredAt` (only when `occurredAt !== receivedAt`, else receipt order) > receipt order; final deterministic tiebreak by `eventId` (PRD §13.4).
  - `isLateEvent(candidate: AgentEvent, lastAccepted: AgentEvent | undefined, session: Pick<SessionRecord, "lastEventAt">): boolean` — candidate older than the last accepted state-changing event for the same `(adapterId, sessionId)`; closing events for an open request are never late (returned to the caller as `closesOpenRequest`).
  - `isTrustworthyTime(event: AgentEvent): boolean` — `occurredAt !== receivedAt`.

- [ ] **Step 1: Write failing tests (RF2, RF3):** sequence beats timestamps; missing sequence falls back to `occurredAt`; untrustworthy times fall back to receipt order; late event with an older sequence is flagged; equal sequence + equal receipt falls back to `eventId` deterministically.
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/ordering.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure comparison functions.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add event ordering and lateness rules`.

---

### Task 1.7: Session state machine — core transitions

**Files:**
- Create: `packages/core/src/state/session.ts` (types), `packages/core/src/state/transitions.ts`
- Test: `tests/unit/core/state-transitions.test.ts`

**Interfaces:**
- Produces:
  - `SessionState` union (PRD §13.1), `SessionStateConfidence = "authoritative" | "inferred" | "unverified"`.
  - `SessionRecord` — `adapterId`, `sessionId`, `agentName`, `state`, `stateConfidence`, `lastEventAt`, `lastSeenAt`, `lastVerifiedAt`, `pendingRequests: PendingRequest[]`, `tasks: TaskRecord[]`, `isSubagent`, `parentSessionId?`, `projectName?`, `workingDirectory?`, `lastAcceptedSequence?`.
  - `PendingRequest = { kind: "input" | "approval"; requestId: string; openedAt: string; remindersSent: number }`.
  - `applyEvent(session: SessionRecord | undefined, event: AgentEvent, now: string): StateTransition` where `StateTransition = { session: SessionRecord; stateChanged: boolean; openedRequest?: PendingRequest; closedRequest?: PendingRequest; completionScope?: CompletionScope }`.
  - `applyEvent` never mutates its input (returns a new record).

- [ ] **Step 1: Write failing tests** for every PRD §13.2 row and every §13.3 rule: create/revive on `started`; late-joined sessions get `stateConfidence: "inferred"`; `needs_input`/`needs_approval` open requests; `resumed(input_provided)` closes and returns to working; inferred resume via `progress` is `inferred`; denial closes without staying in `waiting_for_approval`; `completed`/`failed` never overwritten by the other for the same task/turn; terminal states resumable on `started`/`new_prompt`; `session_ended` closes requests; `turn_ended` → `idle` and never `completed` (AC-F10-04).
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/state-transitions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the transition table as data + a small reducer; return `stateChanged: false` when a late/duplicate/no-op event arrives.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add session state machine core transitions`.

---

### Task 1.8: Task scope and subagent semantics

**Files:**
- Modify: `packages/core/src/state/transitions.ts`
- Test: `tests/unit/core/state-tasks-subagents.test.ts`

**Interfaces:**
- Consumes: Task 1.7 `applyEvent`.
- Produces: `TaskRecord = { taskId: string; state: "active" | "completed" | "failed"; startedAt: string; endedAt?: string }`; `applyEvent` behavior:
  - `completed(scope: "task")` marks only that task completed; session becomes `completed` only if no active tasks remain AND the adapter declares `supportsTaskScope` (PRD F2-R8, D-13).
  - Subagent events update `session.state` but never the parent's; `applyEvent` marks a transition `affectsParent: boolean` so the pipeline can apply `subagents.notify` (D-14).
  - Unknown parent (`parentSessionId` with no matching session) → treated as independent (PRD §13.5).

- [ ] **Step 1: Write failing tests:** AC-F2-06 (task completes while another active → session stays `working`); AC-F2-07 (subagent completion leaves parent untouched); subagent `needs_input` opens a request on the subagent; unknown parent treated independently.
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/state-tasks-subagents.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add task scope and subagent state semantics`.

---

### Task 1.9: Deduplication fingerprints

**Files:**
- Create: `packages/core/src/dedupe/fingerprint.ts`
- Test: `tests/unit/core/fingerprint.test.ts`

**Interfaces:**
- Produces: `computeFingerprints(event: AgentEvent, fallbackWindowSeconds: number): { primary: string; adjacent?: string } | null`:
  - Rule 1 (`eventIdStability === "source"`): `sha256(adapterId + "|" + sessionId + "|" + eventId)`, no adjacent.
  - Rule 2 (`dedupeKey` present): `sha256(adapterId | sessionId | dedupeKey)`.
  - Rule 3: `sha256(adapterId | sessionId | taskId ?? "" | eventType | requestId ?? "" | bucket)` with `bucket = floor(epochMs(occurredAt) / (fallbackWindowSeconds * 1000))` plus the previous bucket as `adjacent`.
  - `agent.progress` → `null` (never fingerprinted, PRD §14.4).
  - `requestId` changes always produce a new fingerprint.

- [ ] **Step 1: Write failing tests** for all three rules, null encoding with fixed delimiters, adjacent-bucket duplicate detection, progress → null, and same event different session → different fingerprint (RF2/RF3).
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/fingerprint.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `node:crypto`'s `createHash` — hashing is pure computation and `node:crypto` is intentionally not in Task 1.1's FORBIDDEN list (only fs/child_process/net/http and timers are banned).
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add deduplication fingerprints`.

---

### Task 1.10: Quiet hours evaluation

**Files:**
- Create: `packages/core/src/policy/quiet-hours.ts`
- Test: `tests/unit/core/quiet-hours.test.ts`

**Interfaces:**
- Produces:
  - `parseClockMinutes(value: string): number | undefined` — `"23:00"` → 1380; rejects malformed values.
  - `isWithinQuietHours(minutesOfDay: number, startMinutes: number, endMinutes: number): boolean` — half-open interval `[start, end)`; supports ranges crossing midnight; `start === end` → always false.
  - `quietHoursSuppressions(config: AgentAttentionConfig, minutesOfDay: number): { sound: boolean; voice: boolean; desktop: boolean }` per `suppressSound`/`suppressVoice`/`suppressDesktop` (PRD F8-R2).

- [ ] **Step 1: Write failing tests (RF3):** AC-F8-07 (23:00–08:00 suppresses 23:30 and 02:00, not 12:00); boundary 23:00 inclusive, 08:00 exclusive; `start === end` never suppresses; disabled quiet hours never suppress; per-channel flags independent.
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/quiet-hours.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** pure integer-minute comparisons; document that DST safety comes from evaluating wall-clock minutes, never durations.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add quiet hours evaluation`.

---

### Task 1.11: Templates, privacy modes, and rendered notifications

**Files:**
- Create: `packages/core/src/presentation/templates.ts`
- Test: `tests/unit/core/templates.test.ts`

**Interfaces:**
- Produces:
  - `renderNotification(input: RenderInput): RenderedNotification | null` where `RenderInput = { eventType; completionScope?; isReminder?: boolean; agentName?: string; projectName?: string; timeLabel: string; privacy: { mode: "standard" | "discreet"; showProjectName: boolean }; coalescedCount?: number }` and `RenderedNotification = { title: string; body: string; speech: string }`.
  - Exact strings from PRD §14.3, verbatim (including `"·"` separator); `timeLabel` is the caller-formatted local-time string substituted for `{time}` (the host formats local time; core stays deterministic).
  - `discreet` mode uses only the discreet template row; `showProjectName: false` omits `{project}` and its separator; unsafe/missing names omit the placeholder.
  - `turn_ended` wording never contains success/completion words (AC-F10-01, F10-R2).
  - Speech omits agent name unless `isVoiceSafeName`.
  - Events with no channel mapping (`progress`, `state_unknown`, `started`, `resumed`, `approval_resolved`, `session_ended`) → `null` (PRD §14.1).

- [ ] **Step 1: Write failing tests (RF1):** every template row asserted exactly; covert agent name `"pro\u202Eject"` sanitized; hostile project `"; rm -rf ~ #"` appears as inert text in body but is omitted from `speech` (AC-F5-06, AC-F15-01); discreet mode hides both names; missing project drops the separator; inferred turn_ended has no success wording.
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/templates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with a template table keyed by `${eventType}:${completionScope ?? "session"}` using only Task 1.4 sanitizers.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add notification templates and privacy modes`.

---

### Task 1.12: Turn-end precedence and minimum duration

**Files:**
- Create: `packages/core/src/attention/turn-end.ts`
- Test: `tests/unit/core/turn-end.test.ts`

**Interfaces:**
- Produces: `evaluateTurnEnd(input: { turnDurationMs?: number; minTurnSeconds: number; classifiedEventWithinGrace: boolean; isSubagent: boolean; notifySubagents: boolean }): { decision: "alert" | "suppress"; reason?: "below_min_turn" | "grace_superseded" | "subagent" }`.
- Grace-window mechanics live in the host (Phase 2): the core simply decides given `classifiedEventWithinGrace`.

- [ ] **Step 1: Write failing tests:** AC-F10-02 (classified within grace → `suppress/grace_superseded`); AC-F10-03 (turn shorter than `minTurnSeconds` → `suppress/below_min_turn`, event still recorded by pipeline); subagent turn-end suppressed unless `notifySubagents`; unknown `turnDurationMs` → alert (cannot prove short).
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/turn-end.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add turn-end precedence rules`.

---

### Task 1.13: Rate limiting and coalescing

**Files:**
- Create: `packages/core/src/attention/rate-limit.ts`, `packages/core/src/attention/coalesce.ts`
- Test: `tests/unit/core/rate-limit.test.ts`, `tests/unit/core/coalesce.test.ts`

**Interfaces:**
- Produces:
  - `AUDIO_PRIORITY: Record<AgentEventType, number>` with PRD D-10 order (`needs_approval` > `needs_input` > `failed` > `turn_ended` > `completed`); others excluded.
  - `class RollingRateLimiter { constructor(maxAlertsPerMinute: number); admit(event: AgentEvent, nowMs: number, opts: { bypass: boolean }): { admitted: boolean; reason?: "rate_limit" } }` — sliding 60 s window; `bypass` is true when the event opens a new `requestId` for input/approval and no alert of that class occurred in the last `quietPeriodSeconds`… pin exactly: bypass when `requestId` is new and no audible alert for that event class in the preceding 30 s (constant `BYPASS_QUIET_PERIOD_MS = 30_000`).
  - `planCoalescing(alerts: EligibleAlert[], windowSeconds: number): CoalescedPlan` where `CoalescedPlan = { groups: Array<{ eventClass; count; firstAt; lastAt }>; summaryRequired: boolean }` — only same-class alerts merge (F12-R3).
- Consumes: nothing beyond contract types.

- [ ] **Step 1: Write failing tests:** AC-F12-02 (10 events in one second → at most 6 admitted, remainder recorded as `suppressed:rate_limit`, one summary); AC-F12-01 sanity for priority ordering of admission; new `requestId` input/approval after quiet period bypasses (F12-R5); two different sessions don't merge into each other's policy; coalescing keeps every event in the caller's history list.
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/rate-limit.test.ts tests/unit/core/coalesce.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with an injectable `nowMs`; no wall-clock calls inside `core` (purity test enforces).
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add rate limiting and coalescing`.

---

### Task 1.14: Reminder planning

**Files:**
- Create: `packages/core/src/attention/reminders.ts`
- Test: `tests/unit/core/reminders.test.ts`

**Interfaces:**
- Produces:
  - `ReminderTimer = { requestId: string; kind: "input" | "approval"; dueAt: string }`.
  - `planReminderTimers(request: PendingRequest, config: AgentAttentionConfig, now: string): ReminderTimer | undefined` — `undefined` when reminders disabled, `remindersSent >= maxReminders`, or request already resolved.
  - `reminderTextKind = "reminder"` constant consumed by templates (Task 1.11 renders the reminder row).
  - Reminders are cancelled by resolution/resume/session-end/staleness — expressed as `planReminderTimers` returning `undefined` for closed requests.

- [ ] **Step 1: Write failing tests:** disabled → no timer (AC-F14-03); `afterMinutes: 10` → exactly one timer at opened+10 min; after one sent, second call → `undefined` (AC-F14-01); resolved request → `undefined`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/reminders.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** ISO-time arithmetic with the injectable `now`.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add reminder planning`.

---

### Task 1.15: Staleness evaluation

**Files:**
- Create: `packages/core/src/staleness.ts`
- Test: `tests/unit/core/staleness.test.ts`

**Interfaces:**
- Produces: `evaluateStaleness(session: SessionRecord, now: string, config: { workingAfterMinutes: number; waitingAfterHours: number }): { state: SessionState; stateConfidence: SessionStateConfidence } | undefined` — `working` silent past the window → `unknown/unverified` (PRD F7-R4); `waiting_*`/`idle` silent past hours → `unknown/unverified` and closes pending requests with resolution `unknown`; terminal states never stale.
- Also produces `reconcileAfterHostRestart(session: SessionRecord, now: string): SessionRecord` — any non-terminal session without recent verifiable activity → `unknown/unverified` (PRD §13.4, AC-P).

- [ ] **Step 1: Write failing tests (RF3):** AC-F7-04 (stale/working not shown as working); waiting session younger than 12 h stays; waiting session past 12 h → `unknown` and request closed; completed/failed untouched; restart reconciliation demotes a `working` session; `lastSeenAt` (progress heartbeats) counts as activity.
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/staleness.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add staleness evaluation`.

---

### Task 1.16: Event processing pipeline

**Files:**
- Create: `packages/core/src/pipeline/types.ts`, `packages/core/src/pipeline/process-event.ts`
- Test: `tests/unit/core/pipeline.test.ts`, `tests/helpers/memory-store.ts`

**Interfaces:**
- Produces (the spine Phase 2 wires to persistence and providers):
  - `PipelineStore` — `claimFingerprint(fingerprint: string, eventId: string, now: string): { claimed: boolean; duplicateCount?: number }`, `recordEvent(event: AgentEvent, meta: { fingerprint: string; late: boolean; duplicate: boolean }): void`, `loadSession(adapterId: string, sessionId: string): SessionRecord | undefined`, `saveSession(session: SessionRecord): void`, `recordDiagnostic(issue: ValidationIssue | PipelineDiagnostic): void`.
  - `PipelineDependencies = { store: PipelineStore; config: AgentAttentionConfig; capabilities?: AdapterCapabilities; clock: { now(): string; nowMs(): number }; rateLimiter: RollingRateLimiter; quietHoursMinutes(now: string): number }`.
  - `processEvent(input: unknown, deps: PipelineDependencies): ProcessingResult` where `ProcessingResult = { status: "processed" | "duplicate" | "late" | "rejected"; planned: PlannedNotification[]; timers: TimerInstruction[]; diagnostics: PipelineDiagnostic[]; session?: SessionRecord }`.
  - `PlannedNotification = { eventId: string; eventType: AgentEventType; priority: number; channels: Array<{ channel: "sound" | "voice" | "desktop"; decision: "dispatch" | "suppress"; reason?: SuppressionReason }>; rendered?: RenderedNotification }`.
  - `SuppressionReason = "muted" | "quiet_hours" | "focused" | "rate_limit" | "coalesced" | "grace_superseded" | "below_min_turn" | "subagent" | "disabled"`.
  - `PipelineDiagnostic = { code: "validation" | "capability_violation" | "state_conflict" | "internal"; message: string; sessionKey?: string }`.
  - `Clock = { now(): string; nowMs(): number }` (used by Phase 2 wiring).
  - `TimerInstruction = { kind: "grace" | "stale" | "reminder"; dueAt: string; sessionKey: string; requestId?: string }`.
- Pipeline order is exactly PRD §14.2: validate → claim+persist (single store call) → order check → state transition → policy → suppressors (quiet hours → focus → turn-end grace → rate limit/coalesce) → plan dispatch → record delivery intents. Persistence strictly precedes dispatch planning; a duplicate stops after claim and MUST NOT mutate state, notify, or restart timers.

- [ ] **Step 1: Write failing tests with `MemoryPipelineStore`:**
  - Call order assertion: `claimFingerprint` invoked before `recordEvent` before any `planned` output (AC: failed notification never erases an event).
  - Duplicate second delivery → `status: "duplicate"`, store state unchanged, `planned` empty (AC-F8-04).
  - Late event → `status: "late"`, recorded with `late: true`, no state change (except a closing event closes its request).
  - Unsupported capability: adapter declaring `needs_input: "unsupported"` emitting it → `status: "rejected"` + diagnostic (Task 1.16-RF5).
  - `inferred` declaration + `authoritative` confidence event → rejected with diagnostic; `turn_ended` always emitted `inferred`.
  - Turn-end grace: classified event supersedes a pending turn-end plan (AC-F10-02).
  - Quiet hours suppress sound/voice/desktop per config, history recorded (AC-F8-01/02).
  - Global mute suppresses sound+voice, desktop unaffected (AC-F4-05).
  - Policy disabled event class → no channels planned.
  - Approved `approval_resolved` closes request and returns `working` (AC-F3-05); `needs_approval` plans priority above `completed` (AC-F12-01).
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/pipeline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `processEvent`** as a pure composition of Tasks 1.2–1.15; no I/O, no timers (only `TimerInstruction` plans).
- [ ] **Step 4: Run** test and the purity test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add event processing pipeline`.

---

### Task 1.17: Fixture format and replay harness

**Files:**
- Create: `tests/helpers/fixtures.ts`, `tests/fixtures/synthetic/basic-session.jsonl`
- Test: `tests/unit/core/replay.test.ts`
- Modify: `tests/fixtures/README.md` (freeze format), `tests/fixtures/<host>/expected.md` (from Task 0.5)

**Interfaces:**
- Produces: `loadFixture(name: string): FixtureStream` where `FixtureStream = { name: string; events: AgentEvent[]; expected: ExpectedSessionSnapshot[] }`; `replayFixture(stream: FixtureStream, deps: PipelineDependencies): ReplayResult` where `ReplayResult = { sessions: SessionRecord[]; notifications: PlannedNotification[]; statuses: ProcessingResult["status"][] }`.
- Fixture JSONL format: first line `{"kind":"meta","name":...,"host":...,"recordedAt":...,"hostVersion":...}`, then `{"kind":"event","event":{...}}` lines, then optional `{"kind":"expected","adapterId":...,"sessionId":...,"state":...,"stateConfidence":...}` lines. Duplicate-delivery fixtures repeat the same event line.

- [ ] **Step 1: Write failing tests:** synthetic stream `started → progress → needs_input → resumed → completed(session)` yields `completed/authoritative` with no pending requests; replaying the identical stream twice yields no additional notifications (dedupe persists across runs in the harness); expected-snapshot mismatches fail with a diff.
- [ ] **Step 2: Run** `npx vitest run tests/unit/core/replay.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the loader and replay driver; write `basic-session.jsonl`.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `test: add fixture format and core replay harness`.

---

### Task 1.18: Phase 1 exit verification

**Files:**
- Modify: `docs/plans/00-master-plan.md` (checkbox), `docs/event-contract.md` (populate from Tasks 1.2–1.5), `docs/architecture.md` (core module map)
- Test: none new — verification task.

- [ ] **Step 1: Run the full gate:** `npm run ci`. Expected: lint, typecheck, all unit suites, and build pass from a clean checkout.
- [ ] **Step 2: Check PRD §19.1 unit coverage list against the suite:** validation, normalization, ordering, transitions, task/session completion, subagents, fingerprints, quiet hours, mute, policy, volume independence, templates, safe names, staleness, turn-end, rate limit/coalesce, reminders, config fallback. Any uncovered area gets a follow-up task before the phase is marked complete.
- [ ] **Step 3: Run the Review Focus sweep:** confirm RF1–RF5 tests exist and are listed in `docs/event-contract.md`; if a scenario from PRD §19.2 A–C, E–H, J–M relevant to core fails, fix before progressing.
- [ ] **Step 4: Commit** `docs: close phase 1 contract and core`.
