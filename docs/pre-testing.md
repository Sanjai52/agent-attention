# Pre-testing Plan

Status: planning only. No live host, user profile, notification device, or
agent configuration should be changed until this document is approved.

## Purpose

Pre-testing is the controlled manual verification pass between Phase 5
implementation and Phase 6 hardening. It validates the assembled product on a
real Windows machine, records observed behavior, and identifies fixes before
release-hardening work begins.

The pre-test is not a release sign-off. It must not silently expand adapter
capabilities or mark unsupported behavior as successful.

## Current entry conditions

- Branch: `pre-testing`.
- Phase 5 implementation is merged in `main`.
- Local automated gate: lint, dependency check, typecheck, 57 test files,
  600 tests, and build passed on the preceding branch.
- Windows and Node requirements: Windows 10/11, Node `24.20.x`.
- OpenCode CLI installation is available.
- Claude Code fixture and normalizer tests are available, but live Claude hook
  execution is currently blocked because no `claude-hook` executable/runner is
  shipped by the repository. The installer must not be treated as live-ready
  until that runner exists and is tested.

## What will be tested

| ID | Area | Expected outcome | Evidence |
|---|---|---|---|
| PT-01 | Clean baseline | Version, OS, paths, and current configuration are captured before changes | Transcript |
| PT-02 | Build/install | The packed or built OpenCode plugin is loadable without admin rights | Commands and config snapshot |
| PT-03 | OpenCode lifecycle | Start, progress, approval, resolution, completion, failure, interruption, and concurrent sessions match declared capabilities | Host transcript + history |
| PT-04 | Delivery | Sound, toast, and optional voice behave independently; one provider failure does not stop the others | Screenshots/transcript + history |
| PT-05 | Policy | Mute, quiet hours, rate limit, coalescing, minimum turn duration, and deduplication match configuration | Config and history output |
| PT-06 | Persistence | Host restart, spool recovery, stale-session handling, and duplicate replay remain safe | Before/after status/history |
| PT-07 | Installer safety | Repeated install is idempotent; uninstall removes only owned entries and preserves user edits | File snapshots/checksums |
| PT-08 | Security | Hostile names remain inert and bounded; no command, XML, or log injection occurs | Sanitized output/transcript |
| PT-09 | Acceptance | PRD scenarios A–Q are marked pass, fail, blocked, or not applicable with evidence | Acceptance matrix |

## Environment preparation

Run these commands from the repository root in PowerShell. They are setup
commands only; do not start live agents until approval is given.

```powershell
node --version
npm --version
npm ci
npm run ci
npm run build
```

Record the following without copying prompts, model output, secrets, or source
code into the journal:

```powershell
node --version
Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber
claude --version
opencode --version
```

Use a temporary OpenCode profile for the first pass. Do not overwrite the
normal configuration file.

## OpenCode installation procedure

After the build completes, resolve the plugin bundle and choose temporary
configuration/state paths:

```powershell
$repo = (Get-Location).Path
$profile = Join-Path $env:TEMP "agent-attention-pretest"
$config = Join-Path $profile "opencode.jsonc"
$state = Join-Path $profile "install-state"
$plugin = (Resolve-Path (Join-Path $repo "adapters\opencode\dist\index.js")).Path
New-Item -ItemType Directory -Force -Path $profile | Out-Null
node "$repo\packages\cli\dist\index.js" install --host opencode --config $config --plugin $plugin --state-dir $state --json
```

Expected result:

- exit code `0`
- JSON report with `changed: true` on first install
- `opencode.jsonc` contains exactly the plugin entry plus any existing user
  entries
- an ownership marker exists under the selected state directory
- no administrator prompt appears

Repeat the install and expect `changed: false`. Then edit an unrelated config
entry, uninstall, and verify that the unrelated edit remains.

```powershell
node "$repo\packages\cli\dist\index.js" install --host opencode --config $config --plugin $plugin --state-dir $state --json
node "$repo\packages\cli\dist\index.js" uninstall --host opencode --config $config --state-dir $state --json
```

## Host and CLI checks

Use the built CLI for all manual checks:

```powershell
node "$repo\packages\cli\dist\index.js" --help
node "$repo\packages\cli\dist\index.js" doctor --json
node "$repo\packages\cli\dist\index.js" status --json
node "$repo\packages\cli\dist\index.js" history --json
node "$repo\packages\cli\dist\index.js" preview --json
```

Expected outcomes:

- `doctor` reports the Notification Host, database, pipe, providers, and
  adapter capability matrix without crashing when one provider is unavailable.
- `status` and `history` return valid JSON and do not expose agent payload text.
- `preview` submits only the selected notification class and does not require a
  live agent event.

## Safe prompts for manual host scenarios

Use short, deterministic prompts and record only the scenario ID and outcome.
Do not use prompts containing secrets, private code, or destructive commands.

### PT-03A — ordinary completion

```text
Reply with exactly: PRETEST_COMPLETION_OK
```

Expected: OpenCode emits the declared successful completion path; exactly one
completion notification may be planned according to configuration.

### PT-03B — controlled approval

```text
Run the harmless command `node -e "console.log('PRETEST_APPROVAL_OK')"`.
Do not run any other command.
```

Expected: an approval request is recorded without copying the command into the
shared event contract; accepting it records approval resolution and the command
runs once. Rejecting it records denial and the request closes.

### PT-03C — controlled failure

```text
Run exactly `node -e "process.exit(23)"` and report that it failed.
```

Expected: a failure event is classified as failure, never completion, and the
history record contains only the allowed failure code.

### PT-03D — interruption

```text
Wait for 30 seconds, then reply with exactly: PRETEST_INTERRUPTED_OK
```

Expected: interrupt the run manually. The result is a non-success turn end;
it must not be reported as verified completion.

### PT-03E — concurrent sessions

Run two harmless completion prompts in separate sessions at the same time.

Expected: each session retains its own identity, state, and history; neither
session changes the other session’s state.

## Hostile-name scenario

Use a temporary project directory whose name contains shell and markup
characters, for example:

```text
pretest-";$(whoami)-<toast>-\`x\`
```

Expected: no command executes, no toast markup is injected, the displayed name
is sanitized/bounded, and no raw project name is written into a command line.

## Recovery and policy scenarios

For each scenario, capture the expected and actual result:

1. Send the same event twice: one audible alert, one history event identity.
2. Enable global mute: history remains recorded, audible channels are muted.
3. Enter quiet hours: suppressed alerts do not replay after quiet hours.
4. Generate an event burst: audio remains serialized and rate limits apply.
5. Stop the Notification Host, send an event, restart it, and verify spool
   recovery without duplicate delivery.
6. Leave a session working, restart the host, and verify it becomes `unknown`
   until verifiable activity resumes.
7. Disable one provider and verify other channels continue operating.

## Claude Code status

The current repository can install Claude hook configuration and normalize
recorded hook events, but it does not yet provide the executable command that
Claude would invoke for raw hook JSON. Therefore this command is not approved
for live use yet:

```powershell
agent-attention claude-hook
```

Before Claude live pre-testing, the missing hook runner must be implemented,
covered by tests, and verified with a temporary Claude configuration. Until
then, Claude testing is limited to fixture replay and capability review.

## Result recording format

For every scenario record:

```text
Scenario: PT-03B
Date/time:
OS / Node / host versions:
Configuration/profile:
Expected:
Observed:
Result: PASS | FAIL | BLOCKED | N/A
Evidence path:
Notes / follow-up:
```

No code or configuration change should be made during pre-testing without
stopping, recording the failure, creating a separate fix branch, and getting
approval to implement the fix.
