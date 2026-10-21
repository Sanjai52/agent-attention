# Phase 5 — Second Adapter Progress

**Status:** In progress on `phase-5-second-adapter`  
**Base:** `main` at `8fcfb76`  
**Target:** Claude Code 2.1.181  
**Main merge:** Not authorized; no Phase 5 changes have been merged into `main`.

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
- [x] Targeted tests: 4 files, 10 tests passed.
- [x] Full local CI: 55 files, 596 tests, lint, dependency check, typecheck, and build passed.

## Evidence commits

| Worktree | Commit | Scope |
| --- | --- | --- |
| `phase-5-claude-code-adapter` | `4447125` | Adapter capability skeleton |
| `phase-5-claude-code-adapter` | `ea0bbe3` | Duplicate hook suppression |
| `phase-5-claude-code-adapter` | `239856d` | Inferred approval resolution |
| `phase-5-claude-code-adapter` | `22004fc` | Workspace TypeScript boundary fix |
| `phase-5-claude-code-tests` | `931ce2f` | Capability and normalizer tests |
| `phase-5-claude-code-install` | `dcba9f3` | Claude Code installer |
| `phase-5-shared-contract-tests` | `cba40d6` | Shared adapter contract checks |

These slices are integrated into the Phase 5 branch as separate cherry-picked
commits. Their source worktrees remain available for traceability.

## Remaining Phase 5 work

- [ ] Validate the actual Claude Code hook payloads against a trusted local
  interactive run; especially `PermissionRequest`, which is not emitted in
  headless `-p` mode according to S1 evidence.
- [ ] Add recorded Claude Code fixtures under `tests/fixtures/claude-code/`.
- [ ] Add live-smoke evidence and reconcile `docs/host-signal-matrix.md`.
- [ ] Wire the Claude Code installer into the user-facing CLI command path.
- [ ] Add troubleshooting and installation documentation.
- [ ] Run the interleaved multi-adapter acceptance flow through the host/history
  path, not only the normalizer-level proof.
- [ ] Re-run GitHub Actions on the Phase 5 branch and investigate any repeated
  Windows latency or SQLite timeout flakes.
- [ ] Complete the Phase 5 exit checklist and prepare a PR to `main`.

## Capability boundary

Claude Code currently declares:

- authoritative: `started`, `needs_approval`, `failed`, `session_ended`;
- inferred: `approval_resolved` from `PostToolUse`, `turn_ended` from `Stop`;
- unsupported: progress, plain input, resume, verified completion, subagents,
  and host-provided sequence numbers.

No completion event is inferred from `Stop`. No host payload text is copied into
the shared event contract.
