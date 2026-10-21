# Pre-testing Report

Date: 2026-10-21
Branch: pre-testing
Repository state: clean before test execution; this report records test evidence only.

## Executive result

| Area | Result |
|---|---|
| Automated repository gate | PASS |
| OpenCode installer through CLI | PASS |
| Claude installer merge/idempotence/uninstall | PASS |
| Isolated Notification Host and doctor | PASS with provider availability warnings |
| OpenCode CLI live prompt | PASS for model response |
| OpenCode adapter event delivery to Agent Attention history | BLOCKED / not verified |
| Production CLI direct execution from local build | FAIL |
| CLI preview through production host | FAIL |
| Claude Code live hook execution | BLOCKED |
| Phase 6 readiness | NOT READY |

The pre-test must not proceed to broad acceptance or release hardening until the
blocked/failed items below are resolved or explicitly accepted.

## Environment

Captured before testing:

~~~
Date/time: 2026-10-21T21:46:28+05:30
Node: v24.20.0
npm: 11.19.0
Claude Code: 2.1.306
OpenCode: v2.0.32
Get-ComputerInfo: Windows 10 Home Single Language, build metadata 2009
Notification Host doctor: Windows 11 Home Single Language (10.0.26300)
~~~

The Windows metadata discrepancy must be clarified during Phase 6. The doctor
report is produced by the running target and reports 10.0.26300.

## PT-00 — Automated gate

Commands:

~~~
npm install --ignore-scripts --no-audit --no-fund
npm run ci
~~~

The first npm ci attempt was incomplete and left the local dependency tree
without the eslint executable. A locked reinstall then hit Windows EPERM while
removing a package directory. The non-destructive dependency repair completed
successfully.

Final result:

- ESLint: PASS
- dependency check: PASS
- workspace typecheck: PASS
- 57 test files: PASS
- 600 tests: PASS
- production build: PASS

Observed test output includes two harmless whoami: extra operand '/user'
messages from the current Windows command environment; the relevant tests still
passed. This should be cleaned up or explained before release.

## PT-01 — OpenCode installer

Temporary profile: %TEMP%\agent-attention-pretest

First install:

~~~
{"changed":true,"entries":["...\\adapters\\opencode\\dist\\index.js"]}
~~~

Repeated install:

~~~
{"changed":false,"entries":["...\\adapters\\opencode\\dist\\index.js"]}
~~~

Uninstall:

~~~
{"changed":true,"entries":["...\\adapters\\opencode\\dist\\index.js"]}
~~~

Expected result: PASS.

Confirmed:

- first install changes the config;
- repeat install is idempotent;
- uninstall removes the owned entry;
- no administrator prompt was requested.

## PT-02 — Claude installer

Temporary settings path was used under the same profile.

Results:

~~~
first install:    exit 0, changed=true
repeat install:  exit 0, changed=false
uninstall:       exit 0, changed=true
~~~

Expected result: PASS for configuration surgery.

Important limitation: this verifies only settings merge/idempotence/uninstall.
The registered command is not executable in the current product because no
claude-hook runner is shipped.

## PT-03 — Notification Host and doctor

The built host was started with a temporary data directory and unique pipe.
Doctor returned:

~~~
host.running: true
pipe.reachable: true
database.schemaVersion: 1
database.healthy: true
config.valid: true
audio.available: false
tts.available: false
toast.registered: false
focus.supported: false
environment.wsl/ssh/container: false
adapters: []
~~~

Expected result: PASS for host/database/pipe health.

Warnings:

- audio is unavailable in the temporary profile;
- TTS is unavailable;
- toast registration is absent;
- focus support is false;
- no adapter is registered through the host doctor path.

These provider results do not fail the database/pipe path, but they prevent a
full delivery pass.

## PT-04 — CLI entry-point packaging

Attempted:

~~~
node packages\cli\dist\index.js install ...
~~~

Observed:

~~~
ERR_MODULE_NOT_FOUND:
Cannot find module packages/shim/src/client
~~~

The local built CLI still resolves workspace dependencies to TypeScript source
paths when executed directly with Node. The development loader path works, but
the shipped/local artifact path is not self-contained.

Result: FAIL for release-style local execution.

This is a Phase 6 packaging blocker for the intended npx agent-attention
workflow.

## PT-05 — OpenCode live prompt

Using an isolated OpenCode profile and a harmless prompt:

~~~
Reply with exactly: PRETEST_DELIVERY_OK
~~~

OpenCode returned the expected text successfully.

The corrected run used:

- temporary XDG data/config paths;
- temporary APPDATA and LOCALAPPDATA;
- a unique Agent Attention pipe;
- an explicitly started temporary Notification Host;
- the built OpenCode adapter bundle.

The prompt returned PRETEST_DELIVERY_OK.

However, after the run, Agent Attention history was empty:

~~~
{"ok":true,"result":[]}
~~~

Result: BLOCKED / not end-to-end verified.

The host and CLI transport work independently, and OpenCode can complete a
prompt, but the adapter-to-shim-to-host event path has not been proven in this
manual run. The plugin entry/path/loading behavior needs investigation before
claiming live OpenCode delivery.

A first attempt reused an already-running per-user pipe. That run was not used
as evidence. The corrected run used a unique pipe and explicit host process.

## PT-06 — CLI preview

Attempted through the CLI while the host was reachable.

Observed:

~~~
preview is not available in this host
~~~

The CLI advertises preview, but the production runtime does not inject a
preview implementation into the host connection.

Result: FAIL.

This is a concrete wiring gap before acceptance testing.

## PT-07 — Claude live integration

Claude Code version 2.1.306 is installed. The verified adapter evidence is
against 2.1.181.

The repository has:

- Claude capability declarations;
- raw hook event types;
- normalizer;
- fixture replay;
- installer.

The repository does not have:

- a claude-hook executable;
- a raw stdin hook runner;
- a live hook-to-shim process path.

Result: BLOCKED.

No live Claude capability claim should be made until the runner exists and is
tested on a temporary Claude configuration.

## Findings requiring follow-up

| ID | Finding | Severity |
|---|---|---|
| PRE-01 | Built CLI is not self-contained when run directly with Node | High |
| PRE-02 | OpenCode live prompt completes but no Agent Attention history event appears | High |
| PRE-03 | CLI preview is advertised but unavailable in the production host runtime | Medium |
| PRE-04 | Claude installer registers a command that is not implemented | High |
| PRE-05 | Temporary profile reports audio/TTS/toast unavailable | Environment-specific |
| PRE-06 | Windows version metadata differs between PowerShell and doctor | Medium |
| PRE-07 | whoami /user invocation emits command-environment warnings | Medium |

## Decision

Pre-testing is paused at the integration boundary. The following are not yet
authorized as passing:

- end-to-end OpenCode notification delivery;
- OpenCode history verification;
- preview behavior;
- Claude live testing;
- clean-profile acceptance;
- PRD A–Q completion;
- Phase 6 release readiness.

No product code was changed during this report pass. Any fix should be created
on a new branch from main, verified, reviewed, and merged only after approval.

## Rerun after blocker fixes — 2026-10-21

The rerun was performed on the existing `pre-testing` branch using temporary
Windows profiles and a unique named pipe. The real OpenCode configuration was
not modified.

| Previous finding | Rerun result | Evidence |
|---|---|---|
| PRE-01 — built CLI was not self-contained | **PASS** | Bundled `packages/cli/dist/index.js` ran `--help`, OpenCode install/uninstall, and `claude-hook` without source-module errors |
| PRE-02 — OpenCode history was empty | **PASS** | OpenCode v2 loaded the directory plugin entry and history contained `agent.started` and `agent.completed` for one session |
| PRE-03 — preview unavailable | **PASS** | Production host accepted sound, desktop, and voice preview requests; sound preview returned `delivered` in the Windows run |
| PRE-04 — Claude hook runner absent | **PASS** | Packaged `claude-hook` converted raw `SessionStart` JSON into a persisted `agent.started` event |
| PRE-05 — audio/TTS/toast unavailable | **PARTIALLY RESOLVED** | Toast registration and TTS now pass on the real profile; audio doctor reporting remains conservative because the sound provider has no non-playing probe |
| PRE-06 — Windows version metadata discrepancy | **RESOLVED ON THIS MACHINE** | Real doctor reports Windows 11 Home Single Language `10.0.26300`; compatibility coverage on a second Windows build remains a Phase 6 gate |
| PRE-07 — whoami warning | **PASS / CLEANED** | SID lookup now uses `%SystemRoot%\\System32\\whoami.exe`; the prior warning did not recur in the final test run |

Additional packaging correction: OpenCode v2 requires a local plugin directory.
The previous file entry `adapters/opencode/dist/index.js` produced the host log
warning `configured plugin path must be a directory`. The supported entry is
the packaged directory `adapters/opencode/plugin`, whose `index.js` forwards to
the built adapter bundle.

Final automated rerun:

- lint: PASS
- dependency check: PASS
- typecheck: PASS
- tests: 57 files / 600 tests PASS
- production build: PASS

Phase 6 is still not ready for clean-profile and second-build acceptance. The
real provider blockers on this machine are resolved except that audio doctor
reporting is conservative and focus support is intentionally false under VS
Code/OpenCode.

## Real-profile verification — 2026-10-21

The installed OpenCode v2 plugin and packaged Claude hook were exercised against
the real Windows user profiles, then removed again. The original Claude settings
file was restored byte-for-byte and the OpenCode configuration returned to its
previous contents.

| Real-profile check | Result | Evidence |
|---|---|---|
| OpenCode plugin loaded | **PASS** | OpenCode v2 loaded `adapters/opencode/plugin/index.js` from the installed directory entry |
| OpenCode lifecycle delivery | **PASS** | Real prompt persisted authoritative `agent.started` and `agent.completed` records for adapter `opencode` |
| Claude hook delivery | **PASS** | Real settings-installed command persisted authoritative `agent.started` for `real-claude-pretest-fixed` under adapter `claude-code` |
| Host auto-start from plugin runtime | **FIXED / PASS** | Host now starts under Node when invoked from OpenCode/Bun; direct real status and doctor checks reached IPC successfully |
| Windows SID pipe resolution | **FIXED / PASS** | Host and shim use `%SystemRoot%\System32\whoami.exe`; no Git `whoami` warning recurred |
| Sound preview | **PASS** | Real host returned `status: delivered` |
| Desktop preview | **PASS** | CLI-managed Windows install registered the AUMID and shortcut; preview reached the desktop provider |
| Voice preview | **PASS / BOUNDED** | Three SAPI voices are reported and the direct speech script exited `0`; preview remains bounded and may return `queued` while speech completes |

Real diagnostics reported Windows 11 Home Single Language `10.0.26300`, Node
`v24.20.0`, a healthy schema/database, a reachable named pipe, three installed
SAPI voices, registered toast identity, conservative audio reporting, and
unsupported focus integration. Focus is expected under VS Code/OpenCode because
session-to-window attribution is only supported for Windows Terminal/classic
console.

The host-runtime, provider-wiring, resource-resolution, and installer changes
are covered by the full suite: 57 files / 601 tests passed. The CLI now owns
toast registration with `install --host windows` and removal with
`uninstall --host windows`.

## Approved temporary-profile execution — 2026-10-21

| Scenario | Result | Evidence |
|---|---|---|
| PT-01 baseline | **PASS** | Node `v24.20.0`, npm `11.19.0`, Claude `2.1.306`, OpenCode `2.0.32`, Windows 11 `10.0.26300` |
| PT-02 install/idempotence/uninstall | **PASS** | First install changed the temporary config, second returned `changed: false`, and uninstall preserved unrelated `pretestMarker` |
| PT-03A ordinary completion | **PASS** | Temporary profile returned `PT03A_COMPLETION_OK`; history persisted authoritative OpenCode start/completion events |
| PT-04 delivery | **PASS** | Toast registered and desktop preview submitted; SAPI voice probe found three voices; sound preview delivered |
| Claude SessionStart hook | **PASS** | Temporary settings hook persisted `agent.started` for `real-claude-pretest-fixed`; settings restored afterward |

PT-03A took approximately two minutes because the selected model backend was
slow, but the deterministic response and lifecycle pair completed successfully.
PT-03B approval, PT-03C failure, PT-03D interruption, PT-03E concurrency, and
the policy/recovery/security scenarios remain the next manual execution block;
they are not claimed as passed by this report.

## Remaining-scenario execution — 2026-10-21

| Scenario | Result | Evidence |
|---|---|---|
| OpenCode model endpoint | **PASS** | `opencode/big-pickle` completed a deterministic real prompt; prior GitHub Copilot model selections were unavailable in the installed OpenCode integrator |
| PT-03B controlled approval | **PASS / BOUNDED** | Real `opencode/big-pickle` session ran the harmless command once and returned the requested resolution; the standalone run did not expose a separately persisted `permission.asked`/`permission.replied` pair, so approval-signal recall remains covered by fixtures |
| PT-03C controlled failure | **PASS / BOUNDED** | Real session executed `node -e "throw new Error('PT03C_CONTROLLED_FAILURE')"` once and reported exit code 1; OpenCode emitted a terminal completion after the model reported the tool failure, consistent with the adapter rule that tool-step failures are not promoted to `agent.failed` |
| PT-03D interruption | **PASS** | Real session was interrupted during a delayed turn; history persisted `agent.started` followed by inferred `agent.turn_ended`, with no completion |
| PT-03E concurrent sessions | **PASS** | Two simultaneous real sessions returned `PT03E_A_OK` and `PT03E_B_OK`; history contained two distinct session IDs and independent start/completion pairs |
| Duplicate event | **PASS** | Two identical packaged Claude hook inputs persisted one `agent.started` identity |
| Spool recovery | **PASS** | Forced unavailable-pipe input created a spool file; host restart ingested it and consumed the file |
| Hostile input | **PASS** | Shell/markup-shaped project name was accepted as data; no command executed and no raw shell invocation occurred |
| Global mute policy | **PASS** | Mute returned `muted: true`, event history remained persisted, and unmute restored `muted: false` |
| Second Windows build | **BLOCKED** | Only the current Windows 11 build is available in this environment |

The live OpenCode endpoint and all four PT-03 scenario executions are now
closed for this Windows 11 machine. The bounded notes above are evidence limits,
not claims of unsupported behavior: approval signal recall and tool-failure
classification remain backed by the recorded OpenCode fixtures and adapter
tests. A second Windows 10/11 machine or CI runner is still required for the
cross-build gate.

## PRD §19.2 acceptance matrix — validation snapshot — 2026-10-21

| ID | Result | Evidence |
|---|---|---|
| A Blocking question | **PASS (fixture/core)** | Authoritative `agent.needs_input` state and notification paths are covered by synthetic fixtures and core tests; OpenCode declares arbitrary input unsupported |
| B Ordinary progress | **PASS (fixture/core)** | Progress normalizer and no-alert behavior are covered by adapter/core tests |
| C Approval | **PASS (fixture + live bounded)** | OpenCode approval mapping and resolution fixtures pass; live harmless-command run completed on the working endpoint |
| D Completion | **PASS (live + fixture)** | PT-03A and PT-03B/03E persisted authoritative start/completion pairs |
| E Concurrent agents | **PASS (live)** | PT-03E recorded two independent session IDs and terminal pairs |
| F Quiet hours | **PASS (core/manual)** | Quiet-hour suppression preserves history and suppresses delivery |
| G Duplicates | **PASS (live + core)** | Duplicate Claude hook and atomic fingerprint tests produce one identity/delivery |
| H Notification failure | **PASS (core/provider)** | Provider failure isolation tests preserve the event and continue other channels |
| I Uncertain state | **PASS (core/restart)** | Restart reconciliation maps stale working sessions to `unknown` |
| J Idle only | **PASS (fixture/core)** | Turn-ended normalization and non-success wording are covered by adapter/core tests |
| K Classified beats idle | **PASS (core)** | Grace-window precedence tests select classified events over idle |
| L Failure | **PASS / BOUNDED** | Adapter failure fixtures and provider failure tests pass; live PT-03C confirms controlled tool failure is reported without falsely claiming an agent failure |
| M Denial | **PASS (fixture/core)** | Denied approval closes the pending request and does not leave approval-waiting state |
| N Storm | **PASS (core/performance)** | Queue serialization, coalescing, rate-limit, and latency smoke tests pass; a manual 50-event live storm remains Phase 6 performance evidence |
| O Hostile project name | **PASS (live + security tests)** | Hostile-name live check and Windows provider escaping/argument-boundary tests pass |
| P Restart | **PASS (live + integration)** | Spool recovery and restart reconciliation checks pass |
| Q Unsupported environment | **PASS (doctor)** | Doctor reports environment capabilities; current machine correctly reports WSL/SSH/container false and focus unsupported under VS Code/OpenCode |

The matrix is sufficient for pre-testing entry on the current build, but not a
Phase 6 release sign-off: the second Windows build and the remaining Phase 6
performance/security measurement work are still open.
