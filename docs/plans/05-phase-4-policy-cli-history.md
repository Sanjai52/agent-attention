# Phase 4 — Attention Policy, CLI, and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the user-facing product: the `agent-attention` CLI (`status`, `history`, `preview`, `doctor`, `config`, `mute`, `install`, `uninstall`), config hot-reload, and the end-to-end attention policies (quiet hours, rate limiting/coalescing, turn-end grace, focus, reminders, privacy modes, subagent policy, retention) wired into the running host.

**Architecture:** The CLI is a stateless pipe client (PRD F11-R3) — it never writes the database and never reads config directly except for `config` commands (which write the file atomically as sole writer of preferences, D-05). The host owns all policy execution; this phase wires the Phase 1 pure decisions to Phase 2 timers, providers, and storage.

**Tech Stack:** Node 24 `util.parseArgs` (no CLI framework unless justified), the Phase 2 IPC client, Vitest.

**Spec:** `PRD.md` §6 (F4–F15), §7, §8, §13.4–13.5, §14.1–14.5, §15.2, §17.3–17.4, §19.

## Global Constraints

- `--json` output for every command; documented JSON schemas; exit non-zero on failure (F11-R2).
- CLI MUST NOT write the database while the host runs; all state access via the pipe (F11-R3).
- Config writes: atomic (temp + rename), preserve unknown keys, per-key validation with diagnostics (PRD §8.1, AC-F11-04).
- Quiet hours and all wall-clock policy use local wall-clock minutes; no exception may be thrown at DST boundaries (F8-R5).
- Suppressed events are never replayed and never dropped from history; delivery records carry the reason (F8-R4, AC-F8-03).
- Reminders default disabled (D-12); privacy modes affect only presentation, never history (AC-F15-02).

## Review Focus

- **RF3 — DST/cross-midnight boundaries at integration level.** Owning tasks: 4.8 (quiet hours under a fake clock crossing midnight and a DST switch), 4.13 (retention boundary uses local-day semantics consistently).
- **RF4 — Host down / pipe unavailable for every command.** Owning task: 4.1 (typed exit code 3, actionable message for all commands), 4.3/4.4 (status/history behavior when no host runs).
- **RF2 — Duplicate suppression during quiet hours and after rate limits.** Owning task: 4.8 (suppressed duplicates still deduplicate; no burst after quiet hours end).
- **RF5 — `config set` races a running host.** Owning task: 4.2 (atomic write + host watch debounce + last-write-wins with diagnostic).
- **RF8 — JSON contract drift.** Owning tasks: 4.3, 4.4 (snapshot tests for the documented schemas), 4.7 (doctor JSON snapshot).

---

### Task 4.1: CLI skeleton, IPC client, exit codes

**Files:**
- Create: `packages/cli/src/main.ts`, `packages/cli/src/ipc-client.ts`, `packages/cli/src/output.ts`, `packages/cli/src/commands/help.ts`
- Modify: `package.json` (root, `bin` mapping through the CLI package)
- Test: `tests/unit/cli/main.test.ts`

**Interfaces:**
- Produces:
  - `runCli(argv: string[], io: { stdout; stderr; env }): Promise<number>` — command registry keyed by name; unknown command → usage on stderr, exit `2`.
  - Exit codes: `0` success, `1` failure (including partial), `2` usage error, `3` host unavailable after bounded retry, `4` invalid configuration.
  - `createIpcClient(opts: { pipeName: string; budgetMs?: number }): IpcClient` with `request(req: IpcRequest): Promise<IpcResponse>`; on unreachable pipe the CLI (except `config`) attempts the shim spawn path once, waits up to 2 s, then exits `3` with "Notification Host is not running" guidance (RF4).
  - `emit(result, { json: boolean }): void` — JSON is `JSON.stringify` of the typed result; human output is stable columns; both go to stdout, diagnostics to stderr.

- [ ] **Step 1: Write failing tests:** `runCli(["nope"])` → 2; `runCli(["status", "--json"])` with unreachable pipe → 3, stderr mentions recovery; a successful mocked request returns 0 and valid JSON; `--json` never mixes stderr diagnostics into stdout.
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/main.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement with `util.parseArgs` per command module.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add command skeleton and ipc client`.

---

### Task 4.2: Config commands and host config watching

**Files:**
- Create: `packages/cli/src/commands/config.ts`, `packages/cli/src/config-file.ts`, `packages/host/src/config-watch.ts`
- Test: `tests/unit/cli/config.test.ts`, `tests/unit/host/config-watch.test.ts`

**Interfaces:**
- Produces:
  - `configPath(env): string` → `%APPDATA%\AgentAttention\config.json` (PRD §8.1).
  - `readConfigFile(path): { raw: unknown; config: AgentAttentionConfig; diagnostics: ConfigDiagnostic[]; unknownKeys: Record<string, unknown> }`.
  - `writeConfigFile(path, config, unknownKeys): Promise<void>` — atomic temp+rename preserving unknowns; creates the file with `defaultConfig` when missing, never overwriting an existing file (PRD §7.1 step 2).
  - CLI: `agent-attention config path|validate|get <keyPath>|set <keyPath> <value>`; `set` validates the whole result and refuses to write an invalid value; `validate` prints each diagnostic with `keyPath` and the applied fallback (AC-F11-04).
  - Host: `watchConfig(path, { debounceMs: 250, onChange }): { close(): void }` — reads on start and on change; adapters never read it (PRD §8.1).

- [ ] **Step 1: Write failing tests:** round-trip preserves unknown keys byte-for-byte outside the touched value; `set events.needsApproval.sound.volume 150` refused with exit 1 and a diagnostic; `set` to a valid value rewrites only that key; `validate` on a corrupt file lists every fallback (AC-F11-04); watcher debounces three rapid writes into one `onChange`; watcher handles file deleted + recreated (RF5).
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/config.test.ts tests/unit/host/config-watch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add config commands and host config watching`.

---

### Task 4.3: `status` command

**Files:**
- Create: `packages/cli/src/commands/status.ts`, `packages/host/src/status-query.ts`
- Test: `tests/unit/cli/status.test.ts`, `tests/unit/host/status-query.test.ts`

**Interfaces:**
- Produces:
  - `buildStatusReport(store: StatusQueries, now: string): StatusReport` (where `StatusQueries = Pick<PipelineStore, "listSessions" | "openRequests">`) and `StatusReport = { schemaVersion: 1; generatedAt: string; sessions: StatusSession[] }`; `StatusSession = { adapterId; agentName; projectName?; sessionIdShort; state; stateConfidence; lastEventAt; parentSessionId?; pendingRequests: Array<{ kind; requestId?; ageSeconds }> }` (F7-R1, F7-R7, F7-R9).
  - Human output: one block per session with state, confidence, age, nested subagents indented; `unknown` sessions clearly marked.
- Staleness is applied before display via Task 1.15 (AC-F7-04); `sessionIdShort` via Task 1.4.

- [ ] **Step 1: Write failing tests:** AC-F7-01 (two sessions from one agent both listed, isolated); AC-F7-03 (completed vs failed visibly distinct in text output); AC-F7-07 (open pending requests listed with age); AC-F7-02 (input event changes only its session); JSON matches the documented schema snapshot.
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/status.test.ts tests/unit/host/status-query.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add status command`.

---

### Task 4.4: `history` command

**Files:**
- Create: `packages/cli/src/commands/history.ts`, `packages/storage/src/queries/history.ts`
- Test: `tests/unit/cli/history.test.ts`

**Interfaces:**
- Produces:
  - Filters: `--agent <adapterId>`, `--session <sessionId>`, `--type <eventType>` (repeatable), `--since <ISO>`, `--until <ISO>`, `--limit <n>` (default 50, max 500), `--json`.
  - `HistoryReport = { schemaVersion: 1; events: Array<{ eventId; adapterId; sessionIdShort; eventType; confidence; occurredAt; receivedAt; summaryCode?; late: boolean; deliveries: Array<{ channel; status; reason? }> }> }` (F7-R8).
  - Human output: aligned columns, local timestamps, delivery suppression shown compactly (e.g., `sound:suppressed(quiet_hours)`).

- [ ] **Step 1: Write failing tests:** each filter narrows correctly; combined filters AND; default limit and cap enforced; suppressed deliveries visible with reasons (AC-F8-02); completed vs failed vs turn-ended distinctly rendered (AC-F7-03/F2-R7); JSON schema snapshot; empty result exits 0.
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/history.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the storage query + command.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add history command`.

---

### Task 4.5: `preview` command

**Files:**
- Create: `packages/cli/src/commands/preview.ts`
- Modify: `packages/host/src/connection.ts` (handle `Preview`)
- Test: `tests/unit/cli/preview.test.ts`

**Interfaces:**
- Produces: `agent-attention preview <needsInput|needsApproval|turnEnded|completed|failed> [--voice] [--json]` routes through the host so it uses **real** settings — same sound, volume, queueing, and provider path as live alerts (F4-R5, AC-F4-03).
- Preview is exempt from rate limiting and quiet hours (it is an explicit user action) but uses the configured volume/sound and reports the provider result.

- [ ] **Step 1: Write failing tests:** AC-F11-01 (`preview needsApproval` plays the configured approval sound at the configured volume — assert the request reached the provider with `soundId: "approval"`, `volume: 45` default); `--voice` also speaks the template; provider failure → exit 1 with `errorCode`, no crash (AC-F4-06); unknown event class → exit 2.
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/preview.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add preview command`.

---

### Task 4.6: `mute` / `unmute`

**Files:**
- Create: `packages/cli/src/commands/mute.ts`
- Modify: `packages/host/src/connection.ts`, `packages/host/src/lifecycle.ts` (mute state + expiry timer)
- Test: `tests/unit/cli/mute.test.ts`

**Interfaces:**
- Produces: `mute [--for 30m|2h|1d]` and `unmute`; mute state is host-held (in-memory + persisted in `agent_events`-independent state table? No — pin: mute is session-scoped to host lifetime and re-set via CLI; a `--for` duration expires with a host timer; `status --json` reports `mutedUntil`. Config `globalMute` remains the persistent form (D-05).
- Mute suppresses sound+voice only; desktop unaffected (F4-R9, AC-F4-05).

- [ ] **Step 1: Write failing tests:** `mute --for 30m` sets `mutedUntil` and suppresses sound+voice for 29 minutes, not for 31 (fake clock); `unmute` clears immediately; `mute --for 0s` → exit 2; mute state survives host restart only via config (documented behavior).
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/mute.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add mute and unmute`.

---

### Task 4.7: `doctor` command

**Files:**
- Create: `packages/cli/src/commands/doctor.ts`
- Test: `tests/unit/cli/doctor.test.ts`

**Interfaces:**
- Consumes: Task 2.14 `DoctorReport`; renders human text and `--json`.
- Produces: checks displayed with `ok | warn | fail`; unsupported environment (WSL/SSH/container) is a clear `fail`-with-guidance (AC-F11-02); focus awareness reports `unsupported` when Task 0.11 found it unreliable (AC-F13-03); toast registration verified (AC-F6-07); ad-hoc capability matrix per installed adapter from `AdapterCapabilities` (F11-R1).

- [ ] **Step 1: Write failing tests:** a mocked report with WSL sentinel → output contains "unsupported environment" and exit 1; missing toast registration → warn with the fix command; JSON snapshot stable; capability matrix renders every event type's support level (AC-F1-06).
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/doctor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add doctor command`.

---

### Task 4.8: Attention policy integration in the host

**Files:**
- Modify: `packages/host/src/connection.ts`, `packages/host/src/timers.ts`, `packages/host/src/lifecycle.ts`
- Test: `tests/integration/host/policy-integration.test.ts`

**Interfaces:**
- Wires, in pipeline order (PRD §14.2 step 6): quiet hours (local minutes computed from the host's timezone at event time) → focus (4.9) → turn-end grace (timer-based supersede: arm `graceMs` before dispatching a `turn_ended` plan; cancel and re-plan when a classified event arrives, AC-F10-02) → rate limit/coalesce (Task 1.13 `RollingRateLimiter` held in host memory; coalesced summary rendered via template row `coalesced`).
- Config hot-reload (4.2) affects subsequent events only; in-flight timers keep their armed values.
- Delivery records persist every suppression reason (AC-F8-04, AC-F12-02/03).

- [ ] **Step 1: Write failing integration tests** using the real pipe server with stub providers and a temp DB:
  - AC-F8-01/02/03: quiet-hours sound/voice suppressed, history intact, nothing replayed after quiet hours end (advance fake clock across 23:00→08:00).
  - AC-F8-07 integration: a configured 23:00–08:00 range at fake 23:30 and 02:00 suppresses; at 12:00 does not; a range spanning a DST transition does not throw (run the same test twice with `TZ=America/New_York` and a spring-forward date, and once with fall-back).
  - AC-F10-02: idle event then authoritative `completed` inside `graceMs` → one completion alert, the turn-end plan marked `grace_superseded` in delivery records.
  - AC-F10-03: sub-`minTurnSeconds` turn recorded, no alert, delivery `below_min_turn`.
  - AC-F12-01/02: approval + completion arrive together → approval audible first, no overlap; 10 events in 1 s → ≤ 6 audible + one summary, all 10 in history (RF2: duplicates among them still dedupe).
  - Config change mid-run (flip `events.turnEnded.enabled`) is honored for the next event.
- [ ] **Step 2: Run** `npx vitest run tests/integration/host/policy-integration.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the wiring; keep all decisions in core functions from Phase 1.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): integrate attention policy end-to-end`.

---

### Task 4.9: Focus awareness integration (S3-gated)

**Files:**
- Modify: `packages/host/src/lifecycle.ts`, `packages/host/src/connection.ts`
- Test: `tests/integration/host/focus-integration.test.ts`

**Interfaces:**
- Consumes: Task 2.13 `FocusProvider`; config `focus.enabled`, `focus.bypassForApproval`.
- Session→process mapping: per Task 0.11's verified method. If it requires extra event metadata (e.g., terminal PID), amend `PRD.md` (§24) and add an optional contract field in a backward-compatible way (`schemaVersion` stays 1; field optional and documented) — never guess.
- Suppression recorded as `suppressed:focused`; approval bypass respected (D-11).

- [ ] **Step 1: Write failing tests:** AC-F13-01 (focused terminal → `turn_ended` suppressed and recorded); AC-F13-02 (other window focused → alert plays); AC-F13-03 (provider unavailable → nothing suppressed, doctor reports unsupported); `bypassForApproval: true` → approval alerts while focused.
- [ ] **Step 2: Run** `npx vitest run tests/integration/host/focus-integration.test.ts`. Expected: FAIL (or the task closes with the unsupported decision if Task 0.11 said no — update docs in that case).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): integrate focus awareness`.

---

### Task 4.10: Reminder integration

**Files:**
- Modify: `packages/host/src/timers.ts`, `packages/host/src/connection.ts`
- Test: `tests/integration/host/reminders.test.ts`

**Interfaces:**
- Consumes: Task 1.14 `planReminderTimers`; templates' `reminder` row; config `reminders.*` (default disabled).
- Reminders respect mute, quiet hours, focus, and rate limiting (F14-R2); resolution/resume/session-end/staleness cancels the timer (F14-R3); recorded as reminders, not duplicate original events (F14-R4).

- [ ] **Step 1: Write failing tests:** AC-F14-01 (enabled, `afterMinutes: 10` → exactly one reminder ~10 min later, wording "still waiting", none after resolution); AC-F14-02 (reminder due during quiet hours is suppressed with a record, not replayed); AC-F14-03 (disabled → none); reminder appears in history with a distinct marker.
- [ ] **Step 2: Run** `npx vitest run tests/integration/host/reminders.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): integrate reminders`.

---

### Task 4.11: Privacy modes end-to-end

**Files:**
- Modify: `packages/host/src/connection.ts` (render uses config privacy), `tests/integration/host/privacy.test.ts`

**Interfaces:**
- Consumes: Task 1.11 rendering with `privacy.mode` and `privacy.showProjectName`.
- History retains full local metadata regardless of mode (AC-F15-02); discreet mode removes agent and project names from toast and speech (AC-F15-01).

- [ ] **Step 1: Write failing tests:** discreet mode → provider receives title `"An agent needs attention"` and no agent/project substring; standard + `showProjectName: false` → project absent, agent present; `history --json` still lists `agentName`/`projectName` (AC-F15-02).
- [ ] **Step 2: Run** `npx vitest run tests/integration/host/privacy.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): integrate privacy modes`.

---

### Task 4.12: Subagent policy end-to-end

**Files:**
- Modify: `packages/host/src/connection.ts`
- Test: `tests/integration/host/subagents.test.ts`

**Interfaces:**
- Consumes: Task 1.8 `affectsParent`; config `subagents.notify`.
- Default: subagent completed/turn_ended/failed → no notification, no parent change; subagent needs_input/needs_approval → notify attributed to parent project/agent (D-14); `subagents.notify: true` → all notify, still no parent state change for terminal subagent events.

- [ ] **Step 1: Write failing tests:** AC-F2-07 default and enabled variants; subagent input notify contains parent project; parent `status` shows the subagent nested (AC-F7-09 surface check via `buildStatusReport`).
- [ ] **Step 2: Run** `npx vitest run tests/integration/host/subagents.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): integrate subagent notification policy`.

---

### Task 4.13: Retention purge

**Files:**
- Modify: `packages/host/src/lifecycle.ts` (scheduled purge), `packages/storage/src/pipeline-store.ts` (`purgeExpired` refinement)
- Test: `tests/unit/storage/retention.test.ts`

**Interfaces:**
- Produces: purge runs periodically (pin: hourly) and on start; removes events/deliveries/ended-or-stale sessions older than `activityHistory.retentionDays`; **never** removes sessions with open pending requests or non-terminal states; dedupe records use their own `expires_at` (PRD §15.2).

- [ ] **Step 1: Write failing tests:** events older than 7 days purged, newer kept (boundary at exactly 7 days: kept); a 10-day-old `waiting_for_input` session and its request survive (safety); `agent.progress` never appears as rows (assert no such event_type exists); purge is transactional (simulated failure rolls back).
- [ ] **Step 2: Run** `npx vitest run tests/unit/storage/retention.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): add retention purge`.

---

### Task 4.14: Dogfood outcome export

**Files:**
- Create: `packages/cli/src/commands/stats.ts` (local, opt-in; PRD §19.3 outcome signals)
- Modify: `docs/troubleshooting.md` (dogfood journal instructions)
- Test: `tests/unit/cli/stats.test.ts`

**Interfaces:**
- Produces: `agent-attention stats --since <days> --json` → `{ schemaVersion: 1; days: Array<{ date; alertsByClass; suppressedByReason; remindersSent }> }` computed from local delivery records only. No network, no telemetry (PRD §17.4).
- The dogfood journal (alerts judged unhelpful, channels disabled, missed events) is a markdown template the team fills manually — create `docs/dogfood-journal.md`.

- [ ] **Step 1: Write failing tests:** stats aggregates by local date and event class; suppression reasons counted; no network calls (purity-level assertion on imports); `--since 0` → exit 2.
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/stats.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement; create the journal template.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add local stats export for dogfooding`.

---

### Task 4.15: Phase 4 exit verification

- [x] **Step 1: Run** `npm run ci`. Expected: all green.
- [x] **Step 2: Walk PRD F4–F15 acceptance criteria** one by one and map each to a passing test or a recorded exception in `docs/phase-4-acceptance.md`.
- [x] **Step 3: Run acceptance scenarios A–N manually or in the integration harness**; reminder timer behavior and unsupported focus fallback are covered in `tests/integration/host/phase4-acceptance.test.ts`.
- [x] **Step 4: Start dogfooding:** local stats export and journal template are in place; weekly human observation remains opt-in.
- [x] **Step 5: Commit** `docs: close phase 4 policy, cli, and history`.
