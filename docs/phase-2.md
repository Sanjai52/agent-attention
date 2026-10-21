# Phase 2 — Notification Host and Providers: Implementation Report

**Status: COMPLETE** on `phase-2-host-and-providers`; PR #3 is merged with a
merge commit and the branch is preserved.

| Item | Value |
|---|---|
| Plan | [`plans/03-phase-2-host-and-providers.md`](plans/03-phase-2-host-and-providers.md) |
| Branch | `phase-2-host-and-providers` |
| Tasks | 2.1–2.15 complete |
| Gate | `npm run ci` green: lint, depcheck, all workspace typechecks, unit/integration tests, build |
| Exit criteria | Providers fail independently; hostile-name suites pass; crash/restart and single-instance pass; shim budget honored; doctor and latency smoke pass |
| Merge | [PR #3](https://github.com/Sanjai52/agent-attention/pull/3), merge commit, branch preserved |

## 1. Outcome

Phase 2 delivers the complete local delivery path:

- a headless Notification Host with exclusive named-pipe creation, single
  instance, idle exit, crash reconciliation, and spool ingest before serving;
- a protected per-user pipe DACL applied and read back before readiness;
- a single-writer SQLite store built on `node:sqlite`, with versioned
  migrations, atomic claim+insert, crash-atomic event recording, sessions,
  tasks, deliveries, diagnostics, history, and retention;
- a bounded hook shim that connects, spawns a detached host once, retries with
  bounded polling, and then writes one atomic spool file;
- isolated sound, speech, toast, and foreground providers;
- a priority/FIFO audio queue and dispatch records that never roll back or block
  event persistence;
- `doctor` data collection and a measured receipt-to-dispatch latency smoke.

The production composition root (`createDefaultRuntime`) wires the real store,
clock, config defaults, providers, ACL hardener, history/mute/shutdown hooks, and
`runHost`. A hook-shim connection now binds its adapter on the first accepted
`SubmitEvent`; long-lived clients still use `AdapterHello`, and cross-adapter
submissions on one connection are rejected.

## 2. Delivered by area

| Area | Main modules | What landed |
|---|---|---|
| Storage | `packages/storage/src/*` | schema migrations, repositories, `claimEvent`, atomic claim+fingerprint+insert, `last_accepted_sequence`, WAL/busy timeout, retention |
| Notifications | `packages/notifications/src/*` | provider contracts, priority/FIFO audio queue, dispatch, idempotence by `(eventId, channel)`, independent failure records |
| Windows providers | `packages/platform-windows/src/*` | koffi WinMM MCI sound primary + fixed script fallback; SAPI TTS over stdin; AUMID/WinRT toast; foreground process query; koffi pipe ACL hardening/readback |
| Host | `packages/host/src/*` | pipe server, connection dispatcher, lifecycle/timers, spool ingest, runtime composition, doctor, latency test |
| Shim | `packages/shim/src/*` | 950 ms budget, detached spawn, bounded retry, atomic spool, never throws to the host |
| Contract | `packages/contract/src/ipc.ts` | v1 IPC envelopes, parse/encode, line limits |
| Docs | `docs/architecture.md`, `docs/troubleshooting.md`, `docs/spikes/s2-results.md`, `docs/spikes/s3-results.md` | implemented shape, doctor glossary, measured latency, provider evidence |

## 3. Verification evidence

### 3.1 Automated gate

The final `npm run ci` run passed lint, dependency hygiene, the root and every
workspace typecheck, the complete Vitest suite, and every build. The suite
includes:

- provider independence and dispatch idempotence;
- hostile sound paths, hostile TTS text, toast XML sanitization, and safe-name
  rejection;
- pipe server/dispatcher, ACL hardening/readback, single instance, idle exit,
  crash/restart reconciliation, and spool ingest ordering;
- shim budget, spawn, retry, and spool fallback;
- doctor branches and the Windows latency smoke;
- the storage claim/insert and crash-atomic pipeline tests.

The final gate ran **535 tests across 38 files**, all passing.

### 3.2 Real host end-to-end smoke

A real `node packages/host/dist/main.js` was started against a temporary data
directory, then a hook-shim `SubmitEvent` was sent through the built package:

```text
ACL readback:   D:P(A;;FA;;;SY)(A;;FA;;;OW)
submit:         channel=pipe ok=true
shutdown:       channel=pipe ok=true
event:          e2e-needs-input-1 / agent.needs_input
session:        adapter-e2e / session-e2e / waiting_for_input
deliveries:     voice=suppressed, sound=delivered, desktop=unavailable (toast_not_registered)
```

This exercises the production composition root, not a test double: shim →
protected pipe → host → SQLite → dispatch queue → Windows providers. The toast
`unavailable` result is correct because no AUMID/shortcut was installed on this
machine; it proves provider independence rather than a host failure.

Before hardening, the same pipe exposed the Node default DACL, including
`Everyone` and `Anonymous` read. After hardening the readback was the protected
DACL above. The measured hardening call was **0.7 ms** warm.

### 3.3 Provider checks

| Provider | Evidence |
|---|---|
| Sound | koffi MCI read/open/close at volume 0: **103 ms**; audible bundled WAV at volume 1: **839 ms**; real host delivery record `sound=delivered`. Fixed PowerShell MCI/SoundPlayer fallback is covered by unit tests. |
| Speech | Live fixed-script synthesis at volume 0 returned `delivered` in **4.8 s** (cold PowerShell + SAPI). Text remains stdin-only; no event text is on a command line. |
| Toast | Unit tests cover registration probes, sanitized JSON-over-stdin, and typed failures. Live host run returned `unavailable` / `toast_not_registered` without affecting sound or the persisted event. |
| Focus | Live query returned `{ processId: 43360, executable: "Code.exe" }` in **1.56 s**. This is the provider-only surface; session-to-window mapping remains Phase 4 (Q-06). |
| Pipe ACL | Unit test reads the default DACL, hardens it, and asserts the exact protected readback; a missing pipe fails closed with `PipeAclError`. |

### 3.4 Latency

From `docs/spikes/s2-results.md` and the doctor smoke:

| Measurement | Result |
|---|---|
| Receipt→response, 500 `agent.progress` events, isolated | p50 **18.87 ms**, p95 **40.70 ms** |
| Receipt→dispatch, 50 `agent.needs_input` events, isolated | p50 **1.31 ms**, p95 **3.62 ms** |
| Receipt→response, final full-gate runs | p95 **75.31–80.27 ms** |
| Receipt→dispatch, final full-gate runs | p95 **3.42–4.16 ms** |
| Receipt→response under a separate parallel-load run | p95 **147.48 ms** |
| Receipt→dispatch under a separate parallel-load run | p95 **4.87 ms** |
| Target | p95 < 500 ms |

These are warm-cache smoke numbers, not a statistical benchmark, and do not
include audible sound duration or TTS synthesis.

## 4. Decisions and deviations

- **D-03 ACL mechanism:** Phase 0 selected a bundled native helper. Phase 2
  applies the same protected DACL through koffi Win32 calls, already a product
  dependency for sound. This removes a second native artifact to package while
  preserving the requirement: SYSTEM + current user, protected DACL, read back,
  and fail-closed before readiness. PRD D-03/§9.2/§10 were updated.
- **Hook-shim identity:** `AdapterHello` remains the long-lived registration
  path. A hook shim may bind by its first accepted `SubmitEvent`; that avoids
  requiring a capability handshake from a one-shot process. A later event for a
  different adapter on the same connection is rejected.
- **MCI primary:** the sound provider now uses in-process koffi MCI first and
  falls back to the committed fixed script. The script still validates the WAV
  path and uses typed arguments; event text never reaches a command line.
- **Dispatch ordering:** dispatch remains off the IPC acknowledgement path.
  The event/session transaction completes before the plan is queued; delivery
  records may complete asynchronously.

## 5. Known gaps and follow-ups

- **TTS resident worker deferred.** The current speech provider spawns the fixed
  SAPI script per utterance (cold 4.8 s at volume 0). This is off the IPC path
  and does not block other channels or event persistence, but it does not meet
  the "resident worker" wording in Q-05. A persistent worker belongs with the
  Phase 4/6 latency hardening; it is recorded here rather than silently claimed.
- **Toast registration is not performed by Phase 2.** The provider and
  registration probe exist; the installer/CLI path is Phase 4/6. Until then,
  live toasts report `unavailable`.
- **Focus mapping is provider-only.** The foreground query works, but mapping a
  session to its terminal/editor window is the Phase 4 suppressor task (Q-06);
  VS Code remains unsupported and click-to-focus remains deferred (Q-07).
- **Config-file loading is Phase 4.** The host currently uses validated compiled
  defaults and accepts `--data-dir`/`--pipe`; the CLI owns `config.json`.
- **Cross-user ACL behavior was not re-tested in Phase 2.** The readback proves
  the DACL; Phase 0 proved a deny-ACE blocks a second local account. A packaged
  second-profile install remains a Phase 6 verification item.
- **Doctor provider probes are injected.** The default runtime supplies the
  providers, but the Phase 4 CLI must pass sound/voice/toast probes (or accept
  conservative `false` values) when rendering the report.

## 6. Commit trail

The branch contains the storage, notifications, platform, host/shim, doctor,
ACL, MCI, and shim-identity commits. The merge commit is created with
`git merge --no-ff` and the branch is preserved after merge.

## 7. PR

[PR #3 — phase 2: host and providers](https://github.com/Sanjai52/agent-attention/pull/3)
was merged with a merge commit. The `phase-2-host-and-providers` branch is
preserved.
