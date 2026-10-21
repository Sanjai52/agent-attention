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

