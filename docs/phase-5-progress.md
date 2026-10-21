# Phase 5 — Second Adapter Progress

**Status:** Implemented and merged into `main`; pre-testing and Phase 6 hardening are now integrated
**Base:** `main` at `8fcfb76`  
**Target:** Claude Code 2.1.181 evidence baseline; local runtime 2.1.306
**Release readiness:** Implementation, fixture verification, pre-testing, and
Phase 6 hardening evidence are integrated. Clean-profile, second-build, and
release-candidate evidence remain open.

## Completed slices

- [x] Phase 5 orchestration plan and worktree allocation.
- [x] Claude Code package boundary and public exports.
- [x] Truthful capability declaration for verified hooks.
- [x] Synthetic event IDs with dedupe keys for hook-process delivery.
- [x] Duplicate hook suppression.
- [x] Normalization for `SessionStart`, `PermissionRequest`, `PostToolUse`,
      `Stop`, `StopFailure`, `PostToolUseFailure`, and `SessionEnd`.
- [x] Inferred approval resolution from `PostToolUse`, as required by PRD §16.4.
- [x] Payload-safe session/project metadata handling.
- [x] Claude Code install/uninstall merge, backup, idempotence, and preservation test.
- [x] Shared OpenCode/Claude Code capability and interleaving checks.
- [x] Recorded fixture replay: `tests/fixtures/claude-code/basic-hooks.jsonl`.
- [x] Manual live-smoke harness and host-signal evidence documentation.
- [x] User-facing Claude Code install/uninstall CLI routing.
- [x] Installation, troubleshooting, adapter-development, and documentation-index updates.
- [x] Targeted tests: 7 files, 12 tests passed across adapter, contract, and installer paths.
- [x] Full local CI: 57 files, 599 tests, lint, dependency check, typecheck, and build passed.

## Evidence commits

| Worktree                        | Commit    | Scope                             |
| ------------------------------- | --------- | --------------------------------- |
| `phase-5-claude-code-adapter`   | `4447125` | Adapter capability skeleton       |
| `phase-5-claude-code-adapter`   | `ea0bbe3` | Duplicate hook suppression        |
| `phase-5-claude-code-adapter`   | `239856d` | Inferred approval resolution      |
| `phase-5-claude-code-adapter`   | `22004fc` | Workspace TypeScript boundary fix |
| `phase-5-claude-code-tests`     | `931ce2f` | Capability and normalizer tests   |
| `phase-5-claude-code-install`   | `dcba9f3` | Claude Code installer             |
| `phase-5-shared-contract-tests` | `cba40d6` | Shared adapter contract checks    |

These slices are integrated into the Phase 5 branch as separate cherry-picked
commits. Their source worktrees remain available for traceability.

## Remaining Phase 5 work

- [x] Add the recorded Claude Code fixture under `tests/fixtures/claude-code/`.
- [x] Add the manual live-smoke harness and reconcile `docs/host-signal-matrix.md`.
- [x] Wire the Claude Code installer into the user-facing CLI command path.
- [x] Add troubleshooting, installation, and adapter-development documentation.
- [ ] Complete a fresh trusted interactive hook capture; the local runtime is
      2.1.306 while the verified S1 evidence is 2.1.181. An isolated session
      captured `SessionStart`, `StopFailure`, and `SessionEnd`, but Claude returned
      `401 OAuth access token is invalid` before a successful assistant turn;
      `Stop`, tool-use, and approval evidence remain intentionally unclaimed.
- [x] Run the interleaved multi-adapter contract proof and host/history
      acceptance through the IPC connection path.
- [ ] Re-run GitHub Actions on the merged Phase 5 commit and investigate any repeated
      Windows latency or SQLite timeout flakes.
- [x] Complete the implementation exit checklist and merge Phase 5 to `main`.
- [ ] Complete the external evidence follow-up: fresh live capture and GitHub Actions.

## Capability boundary

Claude Code currently declares:

- authoritative: `started`, `needs_approval`, `failed`, `session_ended`;
- inferred: `approval_resolved` from `PostToolUse`, `turn_ended` from `Stop`;
- unsupported: progress, plain input, resume, verified completion, subagents,
  and host-provided sequence numbers.

No completion event is inferred from `Stop`. No host payload text is copied into
the shared event contract.
