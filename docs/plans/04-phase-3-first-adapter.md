# Phase 3 — First Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first host adapter (chosen host from D-01) that normalizes real host signals into the contract, declares capabilities honestly, installs/uninstalls without admin, and passes recorded-fixture tests plus a live smoke suite.

**Architecture:** The adapter is thin (PRD §9.4-A): host discovery, signal→`AgentEvent` normalization, and capability declaration only. It sends events through `@agent-attention/shim` and never touches the database or config. Host-specific naming (plugin entry paths, hook config files) comes from `docs/host-signal-matrix.md` and `docs/spikes/s1-results.md` produced in Phase 0 — the executor reads those first.

**Tech Stack:** TypeScript, the chosen host's documented plugin/hook mechanism (S1), Vitest fixture replay, shim from Phase 2.

**Spec:** `PRD.md` §9.2, §12, §13.5, §16.1–16.7, §18.4, §19.1, and the D-01 host documentation recorded in `docs/host-signal-matrix.md`.

## Global Constraints

- Only signals marked `authoritative` in the S1 matrix may emit classified events; anything weaker maps to `turn_ended` or is declared `unsupported` (F1-R9, F9-R1).
- An adapter MUST NOT emit an event type it declares `unsupported` (PRD §16.2); the core rejects violations — fixture tests assert none occur.
- Adapter never blocks the host: no hook may exceed the shim budget; plugin in-process work is bounded and failure-isolated.
- No payload passthrough: command arguments, file paths, tool payloads, and message text never enter an event (F3-R5, AC-F3-07).
- Factories in the adapter declare `eventIdsStable`, `supportsSequence`, `supportsTaskScope`, `supportsSubagents`, `supportsLiveness`, `supportsResolutionSignals` truthfully from S1 evidence.
- Install/uninstall: merge, never overwrite; idempotent; timestamped backup; no admin (PRD §18.4).

## Review Focus

- **RF1 — Hostile names pass through untouched.** Owning tasks: 3.2, 3.8 (fixture with hostile `projectName` reaches the core and renders inertly).
- **RF2 — Hook fires twice for one host action** (e.g., permission hook + stop hook). Owning tasks: 3.3, 3.5 (dedupe/dedupeKey fixtures).
- **RF5 — Install edits a config file the user also edited.** Owning task: 3.7 (merge + backup + idempotence).
- **RF6 — Host upgrade changes a payload shape.** Owning task: 3.8 (`hostVersionRange`, capability downgrade procedure in PRD §18.3).
- **RF7 — Subagent signals attributed to the parent.** Owning task: 3.6.

---

### Task 3.1: Adapter skeleton and capability declaration

**Files:**
- Create: `adapters/<host>/src/index.ts`, `adapters/<host>/src/capabilities.ts`, `adapters/<host>/src/adapter.ts`
- Test: `tests/unit/adapters/<host>/capabilities.test.ts`

**Interfaces:**
- Consumes: D-01 host; Task 1.2 `AdapterCapabilities`/`AgentAttentionAdapter`; Task 2.6 shim.
- Produces:
  - `createAdapter(deps: { send: (event: AgentEvent) => Promise<void>; hostApi: HostApiLike; agentVersion?: string }): AgentAttentionAdapter`.
  - `capabilitiesFor(hostVersion: string): AdapterCapabilities` — every `events` entry `authoritative | inferred | unsupported` with `sourceSignal`, `verifiedAgainst`, `notes` copied from the S1 matrix.

**Precondition (PRD §22):** complete the competing-approaches review
(community plugins, native hooks, terminal bells, relay services) and record it in
`docs/competitive-review.md` before starting adapter work; confirm differentiation claims
still hold.

- [ ] **Step 1: Write failing tests:** capability declaration validates against the contract schema; every `authoritative` entry cites a `sourceSignal`; a declared `unsupported` event type is rejected by a helper `assertEmittable(eventType)` exported for fixture tests.
- [ ] **Step 2: Run** `npx vitest run tests/unit/adapters/<host>/capabilities.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the skeleton:** `start()` registers host hooks/plugin subscriptions, `stop()` removes them; all normalization flows through a single `emit(event)` that calls `deps.send` and swallows/logs its own failures (adapter failure isolation, PRD §17.5).
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapter-<host>): add skeleton and capability declaration`.

---

### Task 3.2: Session lifecycle signals

**Files:**
- Create: `adapters/<host>/src/normalize/session.ts`
- Test: `tests/unit/adapters/<host>/session.test.ts`
- Fixture: `tests/fixtures/<host>/session-lifecycle.jsonl`

**Interfaces:**
- Consumes: raw signals captured in Task 0.2–0.4 (the chosen host's capture set).
- Produces: `normalizeSessionSignals(signal: HostSignal): AgentEvent[] | undefined` mapping session start → `agent.started`, liveness → `agent.progress` (only if `supportsLiveness`), close → `agent.session_ended`; `source`, `session.sessionId`, `projectName`, `workingDirectory` populated from host fields; `occurredAt` copied from the host when present, else `occurredAt = receivedAt` (PRD §12.3).

- [ ] **Step 1: Write failing tests** replaying `session-lifecycle.jsonl` through `normalizeSessionSignals` and the Phase 1 `processEvent` with a `MemoryPipelineStore`: expected session state after replay; missing metadata stays absent (AC-F1-04); hostile `projectName` from the fixture survives validation and sanitizes at render (RF1).
- [ ] **Step 2: Run** `npx vitest run tests/unit/adapters/<host>/session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Record any host field that is **not** trustworthy and therefore dropped.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapter-<host>): map session lifecycle signals`.

---

### Task 3.3: Approval and resolution signals

**Files:**
- Create: `adapters/<host>/src/normalize/approval.ts`
- Test: `tests/unit/adapters/<host>/approval.test.ts`
- Fixture: `tests/fixtures/<host>/approval-approved.jsonl`, `approval-denied.jsonl`

**Interfaces:**
- Produces: `normalizeApprovalSignals(signal: HostSignal): AgentEvent[] | undefined` — permission request → `agent.needs_approval` (`requestId` from the host's request identity when stable, else synthetic per the S1 Q-08 answer); resolution → `agent.approval_resolved` with `approved | denied | unknown`; `confidence: "authoritative"` only for signals verified authoritative in S1.
- Events carry **no** command/tool/file data (F3-R5); normalization MUST drop those fields explicitly, not incidentally.

- [ ] **Step 1: Write failing tests:** AC-F3-01 (request emits `needs_approval`), AC-F3-05/06 (resolutions close the request and return the session to `working`), AC-F3-04 (duplicate request signal → one alert; a new `requestId` → a new alert), AC-F3-07 (a serialized event contains no substring from the fixture's command/tool fields — assert by searching the JSON for known decoy strings like `DECOY_COMMAND`).
- [ ] **Step 2: Run** `npx vitest run tests/unit/adapters/<host>/approval.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** If the host exposes no resolution signal, declare `supportsResolutionSignals: false` and emit only requests — then adjust Task 3.5's state handling note and the capability test.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapter-<host>): map approval and resolution signals`.

---

### Task 3.4: Blocking input signals (or documented unsupported)

**Files:**
- Create: `adapters/<host>/src/normalize/input.ts`
- Test: `tests/unit/adapters/<host>/input.test.ts`
- Fixture: `tests/fixtures/<host>/blocking-input.jsonl` (only when S1 found a candidate signal)

**Interfaces:**
- Produces: `normalizeInputSignals(signal: HostSignal): AgentEvent[] | undefined` — only if S1 verified an authoritative or fixture-qualified inferred signal; otherwise this module exports nothing and the capability stays `unsupported`, with the user served by `turn_ended` (F1-R9, AC-F1-06).
- For `inferred`: the adapter emits `confidence: "inferred"` and uses the exact `summaryCode: INPUT_REQUIRED`; the §19.3 precision target (≤ 5%) must be demonstrated on the adversarial fixture set before enabling.

- [ ] **Step 1: Write failing tests:** authoritative path emits `needs_input` and reaches `waiting_for_input` (AC-F1-01); plain progress text containing a question mark does **not** emit (AC-F1-02, F1-R7); duplicate signals → one alert (AC-F1-03); resume signal clears waiting and closes the request (AC-F1-05, F1-R10).
- [ ] **Step 2: Run** `npx vitest run tests/unit/adapters/<host>/input.test.ts`. Expected: FAIL (or, for the unsupported path, the test asserts the capability reads `unsupported` and `normalizeInputSignals` is not exported—write it so it fails first, then implement the declaration).
- [ ] **Step 3: Implement; if unsupported, update `docs/host-signal-matrix.md` and capability notes instead of code.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapter-<host>): map blocking input signals` or `docs: record <host> cannot detect blocking input`.

---

### Task 3.5: Turn-ended, completion, and failure signals

**Files:**
- Create: `adapters/<host>/src/normalize/terminal.ts`
- Test: `tests/unit/adapters/<host>/terminal.test.ts`
- Fixture: `tests/fixtures/<host>/turn-end.jsonl`, `completed.jsonl`, `failure-cancelled.jsonl`

**Interfaces:**
- Produces: `normalizeTerminalSignals(signal: HostSignal): AgentEvent[] | undefined`:
  - idle/stop signals → `agent.turn_ended`, `confidence: "inferred"`, with `turnDurationMs` when the adapter can compute it, `dedupeKey: "<sessionId>:turn-<n>"` (synthetic stability for AC-F10 duplicates).
  - verified completion (only if S1 authoritative) → `agent.completed` with `completionScope` per host semantics (task only if `supportsTaskScope`).
  - failure → `agent.failed` with an enumerated `failureCode`; cancellation maps to `cancelled` (no alert by default).
  - **Never** emit `completed` from idle (F2-R3, AC-F2-03, AC-J).

- [ ] **Step 1: Write failing tests:** idle session yields `turn_ended` and state `idle` (AC-F10-01, AC-F10-04), wording has no success claim; verified completion yields `completed` (AC-F2-01/02); process exit without success signal yields no completion (AC-F2-03); a failure followed by `completed` for the same turn does not overwrite (AC-F2-04); a cancelled run emits `failed(cancelled)` and (per default config) plans no alert (AC-F9-03); sub-`minTurnSeconds` turn is recorded but not alerted (AC-F10-03).
- [ ] **Step 2: Run** `npx vitest run tests/unit/adapters/<host>/terminal.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapter-<host>): map turn-end, completion, and failure signals`.

---

### Task 3.6: Task scope and subagent signals

**Files:**
- Create: `adapters/<host>/src/normalize/subagents.ts`
- Test: `tests/unit/adapters/<host>/subagents.test.ts`
- Fixture: `tests/fixtures/<host>/subagents.jsonl` (skip task entirely if S1 found no subagent identity)

**Interfaces:**
- Produces: normalization populating `session.parentSessionId` and `session.isSubagent`; `taskId` populated **only** if S1 confirmed a real task concept (D-13).
- Behavior supplied by Phase 1 Task 1.8 rules: subagent completion/turn-end/failure do not notify or change parent state; subagent input/approval do notify (D-14).

- [ ] **Step 1: Write failing tests:** fixture replay shows nested subagent state under the parent (AC-F2-07), parent unaffected; subagent `needs_input` plans a notification attributed to the parent project; unknown parent treated independently.
- [ ] **Step 2: Run** `npx vitest run tests/unit/adapters/<host>/subagents.test.ts`. Expected: FAIL or SKIP (no subagent support → task closes with a capability note).
- [ ] **Step 3: Implement or declare `supportsSubagents: false`.**
- [ ] **Step 4: Run** test. Expected: PASS/SKIP.
- [ ] **Step 5: Commit** `feat(adapter-<host>): map subagent sessions` or `docs: declare <host> subagent support`.

---

### Task 3.7: Install and uninstall mechanics

**Files:**
- Create: `packages/cli/src/install/host-<host>.ts` (the host-specific installer used by `agent-attention install <host>` / `uninstall <host>`)
- Test: `tests/unit/cli/install-<host>.test.ts`

**Interfaces:**
- Produces:
  - `installHost(deps: { configDir: string; hostConfigPath: string; dryRun?: boolean }): Promise<InstallReport>` — `InstallReport = { changed: boolean; backedUpTo?: string; entries: string[] }`.
  - `uninstallHost(deps: { hostConfigPath: string; configDir: string; purge?: boolean }): Promise<InstallReport>`.
  - Rules: merge into existing host config (never replace it); timestamped backup `*.agent-attention-backup-YYYYMMDDHHmmss` before the first modification; idempotent second run → `changed: false` (PRD §18.4); `uninstall` removes only the entries recorded by install (a marker/manifest under `%LOCALAPPDATA%\AgentAttention\install\<host>.json`), leaves user config and history unless `--purge` (PRD §7.1).
  - Registration of the toast identity (Task 2.12) is part of install; uninstall reverses exactly `created` entries.

- [ ] **Step 1: Write failing tests (RF5):** install into a directory containing an existing user config preserves every unrelated key and adds only the expected entries; second install → `changed: false`, no backup; uninstall restores the pre-install config byte-for-byte when no other changes intervened; uninstall after user edits removes only the marked entries; `purge` removes config+data; no operation writes outside the given directories.
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/install-<host>.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add <host> install and uninstall`.

---

### Task 3.8: Live smoke suite, capability verification, and docs

**Files:**
- Create: `tests/live-smoke/<host>.smoke.ts` (run manually via `npm run smoke:<host>`, documented, not a CI gate per D-08)
- Modify: `docs/host-signal-matrix.md` (capability-vs-measured table), `docs/adapter-development.md` (populate with the process learned here), `docs/troubleshooting.md` (host-specific section), `docs/plans/00-master-plan.md` checkbox

**Interfaces:**
- Produces: a documented smoke script that runs a real host session and asserts the five principal moments are detected per the capability declaration; a measured-vs-declared table (PRD M3 exit).

- [ ] **Step 1: Write the smoke script** covering: session start, progress, approval approved, approval denied, turn end, verified completion, failure/cancel, duplicate delivery, concurrent sessions, subagents (if supported), missing metadata, restart, unsupported lifecycle events.
- [ ] **Step 2: Run the smoke suite manually** on a clean host session; record date, host version, and per-event observed detection/confidence in `docs/host-signal-matrix.md`.
- [ ] **Step 3: Capability downgrade check (RF6):** if any measured behavior contradicts the declaration, downgrade the declaration and re-run fixture tests; record in `PRD.md` §24 if semantics changed.
- [ ] **Step 4: Performance check:** measure shim overhead on the live host (cold and warm); assert p95 < 300 ms, hard cap 1000 ms (PRD §19.3); record in the spike results doc.
- [ ] **Step 5: Review Focus sweep (RF1/RF2/RF5/RF6/RF7):** confirm each has a passing test or a recorded, approved exception.
- [ ] **Step 6: Commit** `docs: close phase 3 first adapter`.
