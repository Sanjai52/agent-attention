# Phase 0 — Feasibility Spikes: Completion Report

**Status: COMPLETE (2026-10-20).** The M0 exit gate is met: D-01/D-03/D-04 are
decided, Q-05/Q-06/Q-07 are answered, the host-signal matrix is written for the
three evaluated hosts, the chosen host's fixtures are frozen, and the schedule
is re-baselined. The branch is not merged; merge waits for explicit user
approval.

| Item | Value |
|---|---|
| Plan | [`plans/01-phase-0-feasibility-spikes.md`](plans/01-phase-0-feasibility-spikes.md) |
| Branch | `phase-0-feasibility-spikes` |
| Base | `main` at `92bae16` (Phase 1 merged) |
| Hosts probed | OpenCode `v2.0.32`, Claude Code `2.1.181`, Codex CLI `0.155.1` |
| OS / Node | Windows `10.0.26300.9711` / Node `v24.20.0` |
| Fixtures | [`../tests/fixtures/opencode/`](../tests/fixtures/opencode/README.md) |
| Evidence logs | [`spikes/s1-results.md`](spikes/s1-results.md), [`s2-results.md`](spikes/s2-results.md), [`s3-results.md`](spikes/s3-results.md) |

## 1. Gate decisions

| ID | Decision | Evidence |
|---|---|---|
| **D-01** | **OpenCode v2.0.32** is the first adapter. It is the only evaluated host with all five authoritative signals: approval, resolution, turn boundary, completion, failure (5/5). Claude Code scored 4/5; Codex CLI scored 2/5. | [`host-signal-matrix.md`](host-signal-matrix.md), S1-12–S1-21, S1-CC, S1-3H |
| **D-03** | Headless Notification Host + shim/in-process adapters; pipe `\\.\pipe\agent-attention-u-<sid8>`; exclusive pipe creation; DACL hardened to SYSTEM + current user **before readiness**; one bounded retry phase; atomic per-event spool with per-session `sequence`; idle exit after no client/session for `session-live-ms` + `idle-ms`. In-process embedding not selected. | S2-01–S2-15; p95 shim 137.9 ms warm, 239.8 ms cold; receipt→dispatch p95 2.64 ms; 10/10 kill recoveries |
| **D-04** | Built-in `node:sqlite` (`DatabaseSync`), Node ≥24.20.0. Reject `better-sqlite3@12.4.1`: postinstall/native-build fragility, including failure under `--ignore-scripts`. | S2-SQL-01–S2-SQL-07 |
| **Q-05** | Sound: in-process `winmm` MCI via `koffi` primary, fixed PowerShell `SoundPlayer` fallback. TTS: fixed PowerShell `System.Speech` script, UTF-8 text via stdin, resident worker. Toast: per-user AUMID + Start Menu shortcut + WinRT `ToastNotificationManager`, fixed PowerShell sender, JSON via stdin. | S3-A, S3-TTS, S3-TO; §10 row now Decided |
| **Q-06** | Foreground detection is reliable; session attribution is only reliable where the session can supply its own HWND (Windows Terminal via `GetConsoleWindow()` + `GW_OWNER`, classic console). VS Code is documented unsupported; panes/tabs are window-scoped. | S3-F-01–S3-F-04 |
| **Q-07** | Click-to-focus is **deferred**. Window-management-only routes delivered no input, and attach-to-foreground succeeded 4/4 as a fallback, but a real toast activation was not verified. No task 4.9 implementation until re-probed. | S3-F-04 |
| **Q-01/Q-02/Q-03/Q-08** | Answered in S1: OpenCode has the most reliable signals; permission requests are distinguishable from plain text; completion is session-scoped only; OpenCode has stable `evt_` IDs and `durable.seq`. | [`s1-results.md`](spikes/s1-results.md) |

## 2. What was verified

### S1 — host signals

- **OpenCode:** seven runtime captures (`permission-allow`, `permission-deny`,
  `plain-text`, `negative-progress`, `abort`, `error-invalid-model`,
  `subagent`), 260 events, 260 unique IDs, 0 duplicates.
  - `permission.asked` / `permission.replied` work at runtime; the latter is
    absent from the V2 docs.
  - Documented `session.idle` **did not fire** (0/260); terminal signals are
    `session.execution.succeeded|failed|interrupted`.
  - Failure, abort, and permission denial are distinguishable.
  - Subagent children expose `parentID`.
  - RF-S1 negative test passes: progress-only turns produce zero approval
    requests.
- **Claude Code:** real TUI hooks and permission dialog. `PermissionRequest` is
  authoritative for approval; there is **no resolution event** (resolution is
  inferred only). `Stop` is a turn boundary, not semantic completion;
  `StopFailure` / `PostToolUseFailure` cover failure. Command hooks block by
  default; warm overhead 5.9–15.2 ms. Model output was mocked after the OAuth
  token expired; host/hooks/dialog were real.
- **Codex CLI:** documented Windows-native hooks (`PermissionRequest`, `Stop`,
  `SessionEnd`, `SubagentStart/Stop`, `Interrupt`), turn-end and subagent
  captures, warm hook lifetime 4–8 ms. The approval hook runtime is
  **[Blocked]** because the probe was untrusted and `codex exec` auto-denies.
  No resolution, completion, or failure hook was found.

### S2 — process and storage

- Named-pipe host/shim/spool prototype on Windows/Node.
- Warm shim p50 114.4 ms / p95 137.9 ms (n=100); cold shim p50 221.2 ms /
  p95 239.8 ms (n=10); with compiled ACL helper p50 277.0 ms / p95 300.1 ms.
- Host cold start p50 85.7 ms / p95 101.1 ms; with ACL helper p50 146 ms /
  p95 229 ms.
- Receipt→dispatch including journal fsync p50 2.31 ms / p95 2.64 ms (n=500);
  client→ack p95 3.30 ms.
- Single instance: second host exits `3`; one live PID remains.
- Spool ordering: 20/20 sequential preserved; concurrent same-millisecond
  writes preserve file order but can invert vs `sequence`, so `sequence` is
  authoritative.
- Idle exit: 4.25 s with shortened timers; crash recovery 10/10 contiguous;
  torn tail and bad-CRC records truncated.
- ACL: Node default grants `Everyone`/`Anonymous` read; post-create DACL
  hardened to `SYSTEM` + current user; deny-ACE control blocked connect
  (`EPERM`). Cross-user connect was not tested (no second account).
- SQLite: `node:sqlite` passes WAL/transactions/unique violations and installs
  without native build; `better-sqlite3` fails the clean-install criterion.

### S3 — Windows delivery

- Sound: SoundPlayer spawn→play median 488 ms; MCI/koffi 278 ms cold, ~85 ms
  warm. Missing/corrupt files produce typed failures; Defender clean; terminal-
  closed run passes.
- TTS: spawn→first audio 841 ms; in-process utterances 199–211 ms; cancel
  ~0.38 s; hostile stdin preserved SHA-256 and created no canary file; missing
  voice handled; terminal-closed run passes.
- Toast: per-user AUMID + Start Menu shortcut registered without admin; WinRT
  toast submitted and visibly rendered; hostile project name rendered as
  literal text; app-disable suppression works; terminal-closed run works;
  cleanup verified. DND-on suppression is **blocked** (no programmatic setter);
  DND detection is verified.
- Focus: 15/15 stable foreground samples; WT/classic console HWND mapping
  works; VS Code PID-only matching produces false positives; all focus routes
  delivered zero keys/mouse; real toast activation unverified.

## 3. Residual limits and risks

These are documented, not hidden:

1. **OpenCode API drift:** V2 is experimental; `permission.replied` is
   undocumented and `session.idle` is documented but absent. Pin v2.0.32
   behavior and re-probe on upgrades.
2. **Claude Code model mock:** the OAuth token expired 2026-06-18. The TUI,
   hooks, and permission dialog were real, but model-dependent subagent and
   `AskUserQuestion` captures remain unavailable.
3. **Codex approval runtime:** documentation-only; headless `codex exec`
   auto-denies approval-needing tools.
4. **Audio/TTS edge cases:** no-device and zero-voice arms were not measured;
   only Windows Defender was tested; true audible onset is an assumption.
5. **Toast limits:** DND-on suppression and a second Windows build were not
   tested. A submitted toast is never claimed as "seen".
6. **Process model:** cross-user connect and post-reboot/10-minute idle were not
   measured; the production native ACL helper is not built.
7. **Click-to-focus:** deferred until a registered-toast activation probe.

## 4. Verification

- Full `npm run ci` on the Phase 0 branch: lint, dependency check, typecheck,
  build, and all unit tests.
- Matrix: 11 criteria × 4 host columns; three hosts evaluated, Gemini CLI not
  evaluated; D-01 scorecard records authoritative counts and the winner.
- Fixtures: seven sanitized OpenCode JSONL captures plus `environment.json`,
  `README.md`, and `expected.md`; paths and global instruction text removed.
- Every spike result uses the six-field record and a `[Verified]` /
  `[Assumption]` / `[Rejected]` / `[Blocked]` tag.

## 5. Why Phase 1 preceded Phase 0

Phase 1 is host-independent and was merged first under the master plan's
execution exception. It built the contract, config, pure core, and replay
harness; it did not inspect host internals or make adapter claims. Phase 0 now
closes the gates that Phase 2/3 need. The core remains unchanged by the spike
outcomes.

## 6. Next step

Present this evidence to the user. After explicit approval, commit the
integration changes, merge `phase-0-feasibility-spikes` into `main` with
`--no-ff`, and cut `phase-2-host-and-providers` from updated `main`. Phase 3
remains blocked until Phase 2 delivers the host/provider wiring; Phase 5's
second host is likely Claude Code (4/5), but D-01 selects only the first host.
