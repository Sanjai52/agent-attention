# Phase 3 — OpenCode Adapter Progress Report

**Status:** COMPLETE with one documented live-approval observation exception.

**Scope:** OpenCode v2.0.32 adapter, recorded-event normalization, adapter
lifecycle, OpenCode installation/uninstallation, and verification.

**Worktrees used:**

| Worktree | Starting point | Role |
|---|---|---|
| `phase-3-opencode-adapter` | `8610dab` — capability skeleton | Adapter, normalizer, fixtures, adapter tests |
| `phase-3-opencode-install` | `4b5a403` — Phase 2 merge | OpenCode config installer/uninstaller and CLI tests |
| `phase-3-first-adapter` | `461fa16` | Existing Phase 3 planning/documentation change |
| `phase-3-competitive-review` | `4b5a403` | Existing clean worktree; review remains open |

No worktree was reset, force-checked out, or cleaned. Existing uncommitted
changes from the OpenCode workers were preserved.

## 1. Starting state

Phases 0–2 were already merged into `main`. Phase 3 had a capability
declaration skeleton in the adapter worktree, but the adapter entry point was
empty, normalization modules were incomplete, and the installer worktree
contained uncommitted installer code. The Phase 3 plan still had all task
checkboxes open.

The frozen OpenCode S1 fixtures were available under
`tests/fixtures/opencode/`, covering approval, denial, completion, failure,
interruption, progress, and subagent captures.

## 2. Work performed

### 2.1 Repository and worktree audit

1. Confirmed that the repository and OpenCode local worktrees were accessible.
2. Inspected branches, worktree paths, commit history, and dirty files.
3. Compared Phase 3 branches with `main`.
4. Identified separate adapter and installer implementation slices.
5. Preserved both slices instead of resetting or destructively merging them.

### 2.2 Capability contract and package boundary

1. Added OpenCode adapter constants and host event types.
2. Added the OpenCode v2.0.32 capability declaration.
3. Declared verified started, progress, approval, approval-resolution,
   interrupted, completion, and failure signals.
4. Kept blocking input, resume, session-ended, and unknown-state events
   declared unsupported.
5. Added `assertEmittable()` to prevent unsupported events from being emitted.
6. Exported capabilities, types, normalizer, and adapter from `src/index.ts`.
7. Removed the incompatible adapter-local `rootDir: "src"` restriction so
   workspace-linked contract sources typecheck correctly.

### 2.3 Event normalization

1. Added contract-safe event construction with source and received timestamps.
2. Propagated stable host event IDs and durable sequence numbers.
3. Added session tracking for project ID, project name, working directory, and
   parent session.
4. Derived project names only from trusted project-directory metadata.
5. Prevented prompt, title, command, tool, message, and model payloads from
   entering normalized events.
6. Added duplicate host-event suppression.
7. Mapped started, progress, completed, failed, and interrupted signals.
8. Ensured interruption becomes `agent.turn_ended`, not success or failure.
9. Mapped approval requests and approved/denied/unknown resolutions.
10. Added subagent parent attribution from `session.created.parentID`.
11. Suppressed repeated terminal signals.

### 2.4 Adapter lifecycle

1. Added `createAdapter()` implementing `AgentAttentionAdapter`.
2. Added asynchronous OpenCode event subscription.
3. Added idempotent `start()` and `stop()` behavior.
4. Added `AbortController` shutdown handling.
5. Routed normalized events through the injected `send()` boundary.
6. Isolated stream and send failures through `onError()`.
7. Added the production `Plugin.define()` entrypoint so OpenCode can load the
   adapter, subscribe to the real host event stream, and send events through
   the Phase 2 shim.

### 2.5 Tests added or completed

Adapter tests cover capability declarations, session start, progress,
completion, failure, interruption, duplicates, approval resolution, payload
redaction, and subagent attribution.

The installer tests cover JSONC merging, backups, idempotence, dry runs,
uninstall after user edits, restoration, purge behavior, and path containment.

## 3. Files changed

### Adapter worktree

| File | Change |
|---|---|
| `adapters/opencode/package.json` | OpenCode plugin development dependency from the existing worker slice |
| `adapters/opencode/tsconfig.json` | Removed incompatible local `rootDir` |
| `adapters/opencode/src/index.ts` | Public exports |
| `adapters/opencode/src/types.ts` | Host event and dependency types |
| `adapters/opencode/src/capabilities.ts` | Capability matrix and emission guard |
| `adapters/opencode/src/adapter.ts` | Lifecycle and event-stream bridge |
| `adapters/opencode/src/plugin.ts` | OpenCode `Plugin.define()` production entrypoint |
| `adapters/opencode/src/normalize/common.ts` | Contract-safe event builder |
| `adapters/opencode/src/normalize/session.ts` | Session and subagent tracker |
| `adapters/opencode/src/normalize/normalizer.ts` | Signal normalization |
| `tests/unit/adapters/opencode/helpers.ts` | Fixture replay helpers from the existing worker slice |
| `tests/unit/adapters/opencode/capabilities.test.ts` | Capability tests from the existing worker slice |
| `tests/unit/adapters/opencode/session.test.ts` | Session/progress tests from the existing worker slice |
| `tests/unit/adapters/opencode/terminal.test.ts` | Terminal tests from the existing worker slice |
| `tests/unit/adapters/opencode/approval.test.ts` | Approval and payload-redaction tests |
| `tests/unit/adapters/opencode/subagents.test.ts` | Subagent attribution test |
| `package-lock.json` | Existing worker dependency-lock change |

### Installer worktree

| File | Change |
|---|---|
| `packages/cli/package.json` | JSONC parser dependency from the existing worker slice |
| `packages/cli/src/index.ts` | Installer API exports |
| `packages/cli/src/install/types.ts` | Installer report and marker types |
| `packages/cli/src/install/opencode.ts` | Install, uninstall, merge, backup, marker, purge, and containment logic |
| `tests/unit/cli/install-opencode.test.ts` | Installer behavior tests |
| `package-lock.json` | Existing worker dependency-lock change |

### Closure artifacts

| File | Change |
|---|---|
| `docs/competitive-review.md` | Alternatives, selection rationale, and controls |
| `docs/host-signal-matrix.md` | Measured-vs-declared OpenCode capability table |
| `tests/live-smoke/opencode.smoke.ts` | Manual real-host capture report |
| `docs/README.md` | Documentation index entries |

## 4. Verification performed

Both worktrees passed:

```text
npm run typecheck
npm run lint
npm run build
```

Full automated suites passed:

| Worktree | Result |
|---|---|
| `phase-3-opencode-adapter` | 43 test files, 556 tests passed |
| `phase-3-opencode-install` | 39 test files, 553 tests passed |
| Adapter-focused tests | 5 files, 21 tests passed |
| Installer-focused tests | 1 file, 18 tests passed |

The first test attempts were blocked by the sandbox's `esbuild spawn EPERM`
restriction. They were later rerun with the required execution permission and
passed.

### Runtime adapter invocation

The public `createAdapter()` API was invoked with the recorded
`permission-allow.jsonl` event stream:

```text
input events: 49
adapter:      opencode
emitted:
  agent.started
  agent.progress
  agent.needs_approval
  agent.approval_resolved
  agent.progress
  agent.completed
```

The normalized approval event retained only the stable request ID and
resolution; command, tool, message, and model payloads were not emitted.

### Runtime installer invocation

The installer and uninstaller were invoked against a temporary JSONC file:

```text
installedChanged: true
containsPlugin:   true
removedChanged:   true
restored:         true
```

The temporary directory was removed afterward.

## 5. Closure status

The Phase 3 implementation core and closure artifacts are complete in the
OpenCode worktrees. A real OpenCode v2.0.32 private-server run observed
`session.execution.succeeded` for a plain-text scenario and
`session.execution.interrupted` for an abort scenario. A later plain-text
repeat produced a host failure, which is recorded as host variability rather
than hidden. A fresh permission-allow attempt did not invoke a permissioned
tool; approval support remains backed by the frozen real-host approval capture
and its passing replay/redaction tests.

The remaining delivery action is review/merge of the two worktree commits into
the integration branch; no implementation or evidence gate remains open.
