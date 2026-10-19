# Phase 2 — Notification Host and Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the headless Notification Host as the single SQLite writer behind a current-user named pipe, with a non-blocking shim, spool fallback, isolated Windows providers (sound, TTS, toast), an audio queue, delivery records, and `doctor` data collection.

**Architecture:** `packages/storage` implements the core's `PipelineStore` on SQLite (binding from D-04). `packages/host` owns the pipe server, lifecycle, timers, and spool ingestion. `packages/shim` is the adapter-facing client with a hard time budget and spool fallback. `packages/notifications` defines provider interfaces, the audio queue, and orchestration with no OS calls; `packages/platform-windows` is the only package with Windows-specific calls (PRD §9.2, §9.4, §11).

**Tech Stack:** SQLite via the D-04 binding, Node `net` named pipes, `node:worker_threads` only if S3 required it, PowerShell fixed scripts for OS delivery (mechanism from Q-05), Vitest.

**Spec:** `PRD.md` §7.1, §8.1, §9, §10, §15, §17.2, §19.1–19.3.

## Global Constraints

- Single writer: only the host opens the database; adapters, shim, and CLI go through the pipe (D-04).
- Shim hard cap ≤ 1000 ms total; exit code always 0 (never blocks the host); on unreachable pipe: spawn detached hidden → retry once → spool (PRD §9.2).
- Providers MUST NOT throw into the core; each returns `delivered | failed | unavailable` with an `errorCode` (PRD §9.4). "Delivered" = submitted to the OS, never "seen".
- `packages/notifications` contains no OS calls; `packages/platform-windows` is the only Windows-specific package (PRD §11 ownership rule).
- Every event is persisted before any dispatch begins (PRD §14.2 step 2 before step 7).
- Provider command construction: fixed scripts, data via stdin or argv without a shell; hostile-name fixtures required (PRD §17.2).
- Windows-only integration tests use `it.skipIf(process.platform !== "win32")`; CI runs `windows-latest`.

## Review Focus

- **RF2 — Duplicate/out-of-order delivery.** Owning tasks: 2.2 (atomic claim), 2.7 (spool ingest order + dedupe), 2.9 (no double audio).
- **RF4 — Windows delivery unreliability.** Owning tasks: 2.5 (crash/restart), 2.8 (audio device gone), 2.10 (missing file/device), 2.11 (no voice), 2.12 (Focus Assist/missing registration), 2.14 (doctor honesty).
- **RF5 — Pipe spoofing/reachability.** Owning tasks: 2.4 (ACL + identity registration), 2.5 (single instance), 2.6 (spool when pipe unreachable).
- **RF1 — Hostile strings at the OS boundary.** Owning tasks: 2.10, 2.11, 2.12 (escaping/inert data paths).
- **RF3 — Host killed mid-write.** Owning task: 2.5 (transactional writes, restart reconciliation).

---

### Task 2.1: Storage bootstrap, schema, and migrations

**Files:**
- Create: `packages/storage/src/db.ts`, `packages/storage/src/migrations.ts`, `packages/storage/src/schema.sql.ts`
- Test: `tests/unit/storage/migrations.test.ts`

**Interfaces:**
- Consumes: D-04 binding from Task 0.7.
- Produces:
  - `openDatabase(path: string): AgentAttentionDb` — WAL mode, foreign keys on, busy timeout; fails cleanly when locked by another process.
  - `migrate(db: AgentAttentionDb): { from: number; to: number; backupPath?: string }` — forward-only, transactional, backs up the previous file first (PRD §15).
  - Tables exactly as PRD §15.1: `schema_migrations`, `agent_sessions`, `agent_tasks`, `agent_events`, `event_deliveries`, `pending_requests`, `dedupe_records` — no preferences table (D-05).

- [ ] **Step 1: Write failing tests** with a temp-dir database: fresh open creates all tables and `schema_migrations` row `version 1`; reopening is idempotent; a migration failure rolls back and leaves the previous version intact; opening a locked DB (second process simulated with a second connection in write mode) fails with a typed error, never corrupts.
- [ ] **Step 2: Run** `npx vitest run tests/unit/storage/migrations.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the binding wrapper and migration runner; keep SQL in `schema.sql.ts` as tagged template strings executed in order.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(storage): add schema and migrations`.

---

### Task 2.2: Repositories and the atomic dedupe claim

**Files:**
- Create: `packages/storage/src/repositories/{sessions,events,deliveries,requests,dedupe}.ts`, `packages/storage/src/pipeline-store.ts`
- Test: `tests/unit/storage/pipeline-store.test.ts`

**Interfaces:**
- Consumes: Task 1.16 `PipelineStore` interface; Task 2.1 database.
- Produces: `createPipelineStore(db: AgentAttentionDb, options: { retentionDays: number }): PipelineStore & { close(): void }` implementing:
  - `claimFingerprint` → `INSERT INTO dedupe_records ... ON CONFLICT DO UPDATE duplicate_count` inside a transaction that also inserts the event row; returns `{ claimed: false, duplicateCount }` on conflict. **The claim and the event insert commit atomically** (PRD §14.2 step 2, F8-R11).
  - `recordEvent`, `loadSession`, `saveSession`, `recordDiagnostic`.
  - Additional queries used by Phase 4: `listSessions()`, `listEvents(filters)`, `listDeliveries(eventId)`, `openRequests()`, `purgeExpired(now)`.
  - Indexes on `agent_events(received_at)`, `agent_events(adapter_id, session_id, occurred_at)`, `dedupe_records(expires_at)`, `pending_requests(resolved_at)`.
- Dedupe retention: `expires_at = first_seen_at + max(fallbackWindowSeconds, 24h)` (PRD §14.4).

- [ ] **Step 1: Write failing tests (RF2):** sequential duplicate claim → second returns `claimed: false` and the stored event row for the first claim is untouched; two concurrent claims (two connections on the same file, one waits on the lock) → exactly one `claimed: true` (AC-F8-08); session upsert round-trips every `SessionRecord` field; `purgeExpired` removes only expired dedupe records and old ended sessions per retention.
- [ ] **Step 2: Run** `npx vitest run tests/unit/storage/pipeline-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** repositories with prepared statements; every multi-row write in one transaction.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(storage): add pipeline store with atomic dedupe claim`.

---

### Task 2.3: IPC protocol

**Files:**
- Create: `packages/contract/src/ipc.ts`
- Test: `tests/unit/contract/ipc.test.ts`

**Interfaces:**
- Produces:
  - `IPC_PROTOCOL_VERSION = 1`.
  - Requests: `AdapterHello { adapterId; adapterVersion; capabilities }`, `SubmitEvent { event: unknown }`, `Status { json: boolean }`, `History { filters }`, `Preview { eventClass; channel; voice: boolean }`, `Ping`, `Mute { until?: string }`, `Unmute`, `Shutdown`.
  - `IpcRequest = { protocolVersion: number; id: string; kind: RequestKind; payload: unknown }`; `IpcResponse = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: { code: string; message: string } }` — both Zod-validated; unknown `kind` and version mismatch produce typed errors, never a crash.
  - Error codes: `unsupported_protocol`, `unknown_kind`, `invalid_payload`, `rejected_event`, `unavailable`.

- [ ] **Step 1: Write failing tests:** every request/response shape round-trips; version mismatch rejects with `unsupported_protocol`; malformed JSON line is answered with an error response, connection stays open; oversized payload (e.g., > 256 KiB) is rejected.
- [ ] **Step 2: Run** `npx vitest run tests/unit/contract/ipc.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** schemas plus `parseIpcLine(line: string): IpcRequest | IpcParseError`.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contract): add ipc protocol schema`.

---

### Task 2.4: Named pipe server, ACL, and adapter identity

**Files:**
- Create: `packages/host/src/pipe-server.ts`, `packages/host/src/connection.ts`
- Test: `tests/integration/host/pipe-server.test.ts` (`skipIf(platform !== "win32")`)

**Interfaces:**
- Consumes: Task 2.3 protocol; Task 2.2 store; Task 1.16 `processEvent`.
- Produces:
  - `createPipeServer(options: { pipeName: string; store: PipelineStore; config: AgentAttentionConfig; providers: ProviderSet; clock: Clock; onActivity(): void }): { close(): Promise<void>; address: string }`.
  - Pipe name: `\\.\pipe\agent-attention-${sanitizedUserName}` (PRD §9.2).
  - ACL: current-user-only per the S2 prototype result (Task 0.6); a connection that fails identity registration within 5 s is dropped.
  - `connection.handleRequest(request: IpcRequest): Promise<IpcResponse>` — pure dispatcher, unit-testable without a socket.

- [ ] **Step 1: Write failing tests:** dispatcher routes each request kind to handlers with mocked store/providers; a `SubmitEvent` with an invalid event returns `ok: false, code: rejected_event` and records a diagnostic; adapter `AdapterHello` binds the connection to `(adapterId)` and a later event with a different `source.adapterId` is rejected (PRD §17.1); two `AdapterHello`s for different adapters on one connection → second rejected.
- [ ] **Step 2: Write the Windows integration test:** start the server, connect a raw `net` client, complete a hello + submit round-trip, assert the event landed in the temp DB. Guard with `skipIf`.
- [ ] **Step 3: Run** `npx vitest run tests/integration/host/pipe-server.test.ts`. Expected: FAIL (or skip off-Windows, failing on Windows).
- [ ] **Step 4: Implement** the dispatcher and pipe server; ACL enforced via the mechanism validated in S2 (Task 0.6).
- [ ] **Step 5: Run** test. Expected: PASS on Windows.
- [ ] **Step 6: Commit** `feat(host): add pipe server and request dispatcher`.

---

### Task 2.5: Host lifecycle — single instance, idle exit, restart reconciliation

**Files:**
- Create: `packages/host/src/lifecycle.ts`, `packages/host/src/timers.ts`, `packages/host/src/main.ts`
- Test: `tests/unit/host/lifecycle.test.ts`, `tests/integration/host/single-instance.test.ts`

**Interfaces:**
- Produces:
  - `shouldExit({ activeSessions, openConnections, lastActivityAt, nowMs, idleMinutes: 10 }): boolean` — exits only when no live (non-terminal) sessions and no connections for the idle window (PRD §9.2).
  - `runHost(argv: string[]): Promise<number>` — migrates, ingests spool (Task 2.7), reconciles sessions with `reconcileAfterHostRestart` (Task 1.15), then serves; graceful shutdown releases pipe, timers, and DB; crash-safe due to transactions.
  - Timers: single `TimerRegistry` for grace windows (`graceMs`), stale checks, reminders, host exit; `arm(instruction: TimerInstruction)`, `cancel(kind, sessionKey)`. Timer firing calls back into the same pipeline path as events.
  - Restart behavior: sessions in `working` become `unknown/unverified` (AC-P).

- [ ] **Step 1: Write failing tests:** `shouldExit` matrix (working session present → false; waiting_for_input → false; all terminal + 10 min quiet → true); timer registry arms/cancels without leaks (`dispose` clears all); a simulated restart call demotes `working` sessions and preserves terminal ones.
- [ ] **Step 2: Write the integration test:** two hosts started against the same pipe name → one serves, the second exits quickly with code 0 and no side effects; kill -9 the first mid-write, start again → DB opens, no corruption, sessions reconciled.
- [ ] **Step 3: Run** `npx vitest run tests/unit/host/lifecycle.test.ts tests/integration/host/single-instance.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** lifecycle, timers, `main.ts`.
- [ ] **Step 5: Run** tests. Expected: PASS on Windows.
- [ ] **Step 6: Commit** `feat(host): add lifecycle, timers, and restart reconciliation`.

---

### Task 2.6: Shim client — bounded runtime, detached spawn, spool fallback

**Files:**
- Create: `packages/shim/src/client.ts`, `packages/shim/src/spawn-host.ts`, `packages/shim/src/spool.ts`, `packages/shim/src/index.ts`
- Test: `tests/unit/shim/shim.test.ts`

**Interfaces:**
- Produces:
  - `sendToHost(request: IpcRequest, options?: { budgetMs?: number }): Promise<ShimOutcome>` where `ShimOutcome = { channel: "pipe" | "spawn" | "spool"; ok: boolean }`.
  - Constants: `TOTAL_BUDGET_MS = 950`, `CONNECT_TIMEOUT_MS = 200`, `SPAWN_RETRY_TIMEOUT_MS = 300`.
  - `spawnHostDetached(): void` — `spawn(process.execPath, [hostEntry], { detached: true, windowsHide: true, stdio: "ignore" })`, then `.unref()`.
  - `appendSpool(event: AgentEvent, dir: string): void` — one JSONL file `spool/<epochMs>-<pid>-<rand>.jsonl`, flushed and closed before exit.
  - `runShim(input: string): Promise<number>` — the hook entry: parse stdin payload → normalize → send → always `return 0`; never writes host-interpretable stdout/stderr beyond a single diagnostic line on stderr prefixed `agent-attention:`. (Adapter normalization is Phase 3; this task takes an already-normalized event JSON.)
- Budget enforcement: an overall `Promise.race` with the remaining budget; exceeding it is treated as "unreachable" and falls through to spool.

- [ ] **Step 1: Write failing tests:** pipe success path calls the client once; unreachable pipe → spawn called once → retry fails → spool file written with the event and valid JSONL; on a second call the spool contains two lines in order; total runtime in a simulated slow-connect (> budget) ends in spool, never hangs; `runShim` returns 0 for every failure mode.
- [ ] **Step 2: Run** `npx vitest run tests/unit/shim/shim.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the client, spawn, and spool; measure with fake timers.
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shim): add bounded client with spawn and spool fallback`.

---

### Task 2.7: Spool ingestion

**Files:**
- Modify: `packages/host/src/lifecycle.ts`, `packages/host/src/spool-ingest.ts`
- Test: `tests/integration/host/spool-ingest.test.ts`

**Interfaces:**
- Produces: `ingestSpool(dir: string, submit: (event: AgentEvent) => Promise<ProcessingResult>): Promise<{ ingested: number; rejected: number }>`.
- Rules: files processed in filename order (epoch prefix = order preserved); each line parsed and submitted through the normal pipeline (so dedupe applies); successfully ingested files are deleted; malformed lines are counted and the file is quarantined as `*.rejected.jsonl`; a partially written final line (host died mid-write) is tolerated and the file retained (RF3).

- [ ] **Step 1: Write failing tests:** three spool files ingest in order, events deduplicate against existing DB records (AC-P), files deleted after success; malformed line quarantined, other lines still ingested; truncated last line does not throw and the file is retried next start.
- [ ] **Step 2: Run** `npx vitest run tests/integration/host/spool-ingest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement; call from `runHost` before serving.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): add spool ingestion with quarantine`.

---

### Task 2.8: Provider interfaces and the audio queue

**Files:**
- Create: `packages/notifications/src/providers.ts`, `packages/notifications/src/audio-queue.ts`, `packages/notifications/src/index.ts`
- Test: `tests/unit/notifications/audio-queue.test.ts`

**Interfaces:**
- Produces:
  - `ProviderResult = { status: "delivered" | "failed" | "unavailable"; errorCode?: string }`.
  - `SoundProvider { play(request: { soundId: string; volume: number; filePath?: string }): Promise<ProviderResult> }`, `SpeechProvider { speak(request: { text: string; voiceId: string | null; volume: number; rate: number }): Promise<ProviderResult> }`, `DesktopProvider { show(request: { title: string; body: string }): Promise<ProviderResult> }`.
  - `ProviderSet = { sound: SoundProvider; voice: SpeechProvider; desktop: DesktopProvider }`.
  - `createAudioQueue(options: { maxQueueLength: number; play: (entry: AudioEntry) => Promise<ProviderResult> }): AudioQueue` with `enqueue(entry: AudioEntry): "queued" | "dropped"`; entries ordered by `AUDIO_PRIORITY` (D-10), stable FIFO within a priority; sequential playback (no overlap, AC-F12-01); overflow drops the lowest-priority entry (never history/toast, F12-R2); `onResult` callback per played/dropped entry.
  - `AudioEntry = { eventId: string; eventType: AgentEventType; kind: "sound" | "voice"; priority: number; payload: unknown }`.

- [ ] **Step 1: Write failing tests:** two enqueued entries play strictly sequentially (fake play resolves slowly); approval ahead of completion when enqueued after (AC-F12-01); queue of 3 + a 4th lower-priority entry → 4th dropped with `reason: "queue_overflow_lowest_priority"`; 4th higher-priority entry evicts the lowest, which is reported dropped; a play rejection is reported as `failed` and does not stop the queue.
- [ ] **Step 2: Run** `npx vitest run tests/unit/notifications/audio-queue.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the queue and interfaces (no OS calls).**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notifications): add provider interfaces and audio queue`.

---

### Task 2.9: Dispatch orchestration and delivery records

**Files:**
- Create: `packages/notifications/src/dispatch.ts`
- Modify: `packages/host/src/connection.ts` (wire dispatch after `processEvent`)
- Test: `tests/unit/notifications/dispatch.test.ts`

**Interfaces:**
- Consumes: Task 1.16 `PlannedNotification`; Task 2.8 provider set + queue; Task 2.2 `event_deliveries` repository.
- Produces:
  - `dispatchPlanned(planned: PlannedNotification[], deps: { providers: ProviderSet; queue: AudioQueue; recordDelivery(record: DeliveryRecord): void; now(): string }): Promise<DeliveryRecord[]>`.
  - Each channel runs independently (`Promise.allSettled`); a provider rejection becomes `failed` with `errorCode`; `suppressed` plans record their reason without invoking providers; every planned channel produces exactly one record (PRD §14.2 step 8).
  - Audio (sound+voice) goes through the queue; desktop dispatches directly.

- [ ] **Step 1: Write failing tests (RF4):** sound provider rejects → desktop still delivered and both records exist (AC-F6-05); toast rejection → event record already persisted (assert store write happened before `dispatchPlanned` was invoked); suppressed reason recorded verbatim; duplicate `PlannedNotification` for one `eventId+channel` results in one delivery (idempotence guard by `(eventId, channel)`).
- [ ] **Step 2: Run** `npx vitest run tests/unit/notifications/dispatch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement; wire into the host request path after persistence.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notifications): add dispatch orchestration and delivery records`.

---

### Task 2.10: Windows sound provider

**Files:**
- Create: `packages/platform-windows/src/sound-provider.ts`, `packages/platform-windows/src/powershell.ts`, `packages/platform-windows/src/index.ts`
- Test: `tests/unit/platform-windows/sound-provider.test.ts` (+ manual check documented in `docs/spikes/s3-results.md`)

**Interfaces:**
- Consumes: Q-05 mechanism decision (Task 0.12).
- Produces:
  - `runFixedScript(options: { scriptPath: string; args: string[]; stdin?: string; timeoutMs: number }): Promise<{ code: number; stderr: string }>` — `spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], { windowsHide: true })`; **never a shell, never string concatenation** (PRD §17.2).
  - `createWindowsSoundProvider(options: { scriptsDir: string; fallbackOnError?: boolean }): SoundProvider` — validates custom sound files (extension allowlist `.wav/.mp3`, size ≤ 5 MiB, readable) and falls back to the built-in default with a diagnostic (F4-R11); missing audio device → `unavailable`, never a crash (AC-F4-06).
  - Bundled default sounds under `packages/platform-windows/assets/sounds/` (`attention`, `approval`, `idle`, `complete`, `failure`).

- [ ] **Step 1: Write failing tests:** hostile `soundId`/path (`"; rm", "$(x)"`, `%TEMP%`) is passed as an argv element and appears nowhere in the script command line; invalid extension and oversized file fall back to default with diagnostics; script non-zero exit → `failed` with `errorCode`; a timeout kills the child and returns `failed`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/platform-windows/sound-provider.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement with a committed fixed `.ps1` script** that plays a path passed as parameter; no interpolation.
- [ ] **Step 4: Run** test; perform the manual playback check on the spike machine and record it.
- [ ] **Step 5: Commit** `feat(platform-windows): add sound provider`.

---

### Task 2.11: Windows speech provider

**Files:**
- Create: `packages/platform-windows/src/speech-provider.ts`, `packages/platform-windows/scripts/speak.ps1`
- Test: `tests/unit/platform-windows/speech-provider.test.ts`

**Interfaces:**
- Produces: `createWindowsSpeechProvider(options: { scriptPath: string; }): SpeechProvider` — spawns the fixed script and delivers text **via stdin only**; enumerates voices via a separate fixed script (`voices.json`); no voice / synthesis failure → `unavailable | failed` without affecting other channels (AC-F5-03); a stop request cancels the current utterance (Q-05 outcome).
- Text is always the rendered template speech from Task 1.11; the provider never receives a raw name outside the allowlist (the template already omits unsafe names).

- [ ] **Step 1: Write failing tests:** hostile text (`"; rm -rf ~ #`, RTL overrides, 10k chars) reaches the child only through stdin (assert argv contains no text); stdin is closed after write so the child cannot block forever; timeout → `failed` and child killed; missing voice id → `unavailable`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/platform-windows/speech-provider.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `speak.ps1` reading stdin (`$input | Out-String`), synthesis via the Q-05 mechanism; volume/rate as typed parameters.**
- [ ] **Step 4: Run** test; manual audible check recorded.
- [ ] **Step 5: Commit** `feat(platform-windows): add speech provider`.

---

### Task 2.12: Windows toast provider and registration

**Files:**
- Create: `packages/platform-windows/src/toast-provider.ts`, `packages/platform-windows/src/toast-registration.ts`, `packages/platform-windows/scripts/toast.ps1`
- Test: `tests/unit/platform-windows/toast-provider.test.ts`, `tests/unit/platform-windows/toast-registration.test.ts`

**Interfaces:**
- Consumes: Q-05 toast mechanism (Task 0.10).
- Produces:
  - `registerToastIdentity(options: { appId: string; displayName: string }): Promise<{ created: string[] }>` and `unregisterToastIdentity(appId: string): Promise<void>` — the exact registry keys/files from Task 0.10, per-user, no admin; returns the list of created entries so `uninstall` can remove exactly those (PRD §18.4).
  - `isRegistered(appId: string): Promise<boolean>` for `doctor` (AC-F6-07).
  - `createWindowsToastProvider(options: { appId: string }): DesktopProvider` — builds the toast content by XML-escaping every interpolated value with a tested escaper (`escapeXml`), passes the XML to the fixed script via a temp file or stdin (never command text); missing registration → `unavailable`; Focus Assist active may still report `delivered` (submitted) — the provider MUST NOT claim seen (F6-R10).

- [ ] **Step 1: Write failing tests:** `escapeXml('a<b>&"\'')` escapes all five; a toast title containing `<script>` renders escaped in the generated XML; hostile agent name produces valid XML (parse it back with a parser); `isRegistered` false when keys absent; registration functions are idempotent.
- [ ] **Step 2: Run** `npx vitest run tests/unit/platform-windows/toast-provider.test.ts tests/unit/platform-windows/toast-registration.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement scripts and provider; temp XML file uses `mkdtemp` and is deleted in `finally`.**
- [ ] **Step 4: Run** tests; manual toast check with Focus Assist on/off recorded (AC-F6-01..04).
- [ ] **Step 5: Commit** `feat(platform-windows): add toast provider and registration`.

---

### Task 2.13: Focus detection provider (S3-gated)

**Files:**
- Create: `packages/platform-windows/src/focus-provider.ts`
- Test: `tests/unit/platform-windows/focus-provider.test.ts`

**Interfaces:**
- Gate: only if Task 0.11 marked F13 viable; otherwise this task is skipped and `docs/architecture.md` records why (F13-R2).
- Produces: `createWindowsFocusProvider(): FocusProvider` where `FocusProvider = { getForeground(): Promise<{ processId: number; executable: string } | undefined> }`; the mapping from a session to its host terminal/editor process is supplied by the host config (Phase 4 Task 4.9).

- [ ] **Step 1: Write failing tests** with an injectable foreground source: query unavailable (helper exits non-zero) → `undefined` and callers do not suppress (AC-F13-03).
- [ ] **Step 2: Run** `npx vitest run tests/unit/platform-windows/focus-provider.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** via a fixed helper script/mechanism from Task 0.11.
- [ ] **Step 4: Run** test; manual check with terminal focused vs not (AC-F13-01/02) recorded.
- [ ] **Step 5: Commit** `feat(platform-windows): add focus provider`.

---

### Task 2.14: Doctor data collection and latency smoke

**Files:**
- Create: `packages/host/src/doctor.ts`
- Test: `tests/unit/host/doctor.test.ts`, `tests/integration/host/latency-smoke.test.ts`

**Interfaces:**
- Produces: `collectDoctorReport(deps: { config; store; pipe: { reachable: boolean }; providers; platform }): Promise<DoctorReport>` where `DoctorReport = { windowsVersion; nodeVersion; host: { running: boolean; pid?: number }; pipe: { name: string; reachable: boolean }; database: { schemaVersion: number; healthy: boolean; path: string }; config: { valid: boolean; diagnostics: ConfigDiagnostic[] }; audio: { available: boolean }; tts: { available: boolean; voices: string[] }; toast: { registered: boolean }; focus: { supported: boolean }; environment: { wsl: boolean; ssh: boolean; container: boolean }; adapters: AdapterCapabilities[] }` — the Phase 4 CLI renders this (PRD F11-R1).
- Environment detection: `WSL_DISTRO_NAME`/`/proc/version` heuristics, `SSH_CONNECTION`, container sentinel files — **detection only**, recorded not enforced here.
- Latency smoke: submit 50 events/second through the pipe; assert receipt-to-dispatch p95 < 500 ms (PRD §19.3) and record the number in `docs/spikes/s2-results.md`.

- [ ] **Step 1: Write failing tests** with mocked deps for every report branch; unsupported environment flags true when the sentinel env vars are present (AC-F11-02 at unit level).
- [ ] **Step 2: Write the latency integration test** (Windows, temp DB, stub providers): measure receipt-to-dispatch over 500 events in bursts of 50/s; assert p95 < 500 ms.
- [ ] **Step 3: Run** `npx vitest run tests/unit/host/doctor.test.ts tests/integration/host/latency-smoke.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** tests; record latency in the spike results and `docs/troubleshooting.md` header.
- [ ] **Step 6: Commit** `feat(host): add doctor report and latency smoke`.

---

### Task 2.15: Phase 2 exit verification

- [ ] **Step 1: Run** `npm run ci`. Expected: all green on Windows.
- [ ] **Step 2: Verify PRD M2 exit:** providers fail independently (kill each provider in tests), hostile-name suite passes (Tasks 2.10–2.12), crash/restart and single-instance pass (Task 2.5), shim budget honored (Task 2.6).
- [ ] **Step 3: Update** `docs/architecture.md` (component map, pipe, storage), `docs/troubleshooting.md` (doctor output glossary), master plan checkbox.
- [ ] **Step 4: Commit** `docs: close phase 2 host and providers`.
