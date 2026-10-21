# Agent Attention Progress: Scaffold through Phase 4

**Audit date:** 2026-10-21  
**Audited branch:** `main`  
**Current commit:** `7c1ed1a` — `feat: complete phase 4 policy cli and history`  
**Phase 4 integration:** PR #5, `phase-4-policy-cli-history` → `main`

## Executive status

Phases 0 through 4 are complete in the repository for the capabilities that
are supported by the current host/event contract. Phase 3 provides the first
OpenCode adapter and installer. Phase 4 provides policy, CLI, history,
retention, dogfood reporting, doctor transport, and acceptance evidence.

The primary intentional gap is F13 focus suppression. The release reports it
as unsupported because the current event contract does not provide verified
session-to-window attribution; the host does not guess focus state or suppress
alerts incorrectly.

## Overall checklist

### Scaffold and project foundation

- [x] npm workspace structure for core, contract, host, shim, CLI, and adapters.
- [x] Shared TypeScript configuration, linting, formatting, testing, and build scripts.
- [x] Source-of-truth PRD, phase plans, decision records, and progress reports.
- [x] Conventional commit history using `feat:`, `docs:`, and `merge:` prefixes.

### Phase 0 — Feasibility and decisions

- [x] First-host selection: OpenCode v2.0.32.
- [x] Process model: host, pipe, spool, ACL hardening, and bounded retry.
- [x] SQLite binding and single-writer storage direction.
- [x] Windows sound, TTS, toast, Focus Assist, and focus feasibility spikes.
- [x] WSL, SSH, dev-container, and remote execution declared unsupported for MVP.
- [x] F13 scope narrowed to hosts with verified session/window metadata; VS Code remains unsupported.

### Phase 1 — Contract and pure core

- [x] Versioned event contract and capability declarations.
- [x] Lifecycle/state transitions, deduplication, ordering, and sequence handling.
- [x] Policy decisions for quiet hours, suppression, coalescing, rate limits, and precedence.
- [x] Reminder, privacy, retention, and delivery decision models.
- [x] Deterministic unit and property-oriented tests for the pure core.

### Phase 2 — Host and Windows delivery

- [x] Notification Host lifecycle and IPC pipe server/client.
- [x] SQLite persistence, migrations, delivery records, dedupe, and purge primitives.
- [x] Hook shim, spool/retry path, and host connection handling.
- [x] Audio, TTS, toast, and Windows environment providers.
- [x] Doctor data model and host health checks.
- [x] Host restart, malformed input, duplicate delivery, and storage safety coverage.

### Phase 3 — First adapter: OpenCode

- [x] OpenCode capability declaration and unsupported-event guard.
- [x] `Plugin.define()` production entrypoint and lifecycle management.
- [x] Recorded-event normalization for progress, approval, completion, failure, and interruption.
- [x] Stable event IDs, durable sequences, session tracking, subagent attribution, and redaction.
- [x] OpenCode JSONC installation, backup, idempotent uninstall, restore, and containment checks.
- [x] Frozen fixture replay, adapter tests, installer tests, and live-smoke evidence.
- [x] Competitive review and measured-versus-declared capability documentation.
- [x] Phase 3 worktree changes reviewed and integrated; no implementation gate remains open.

### Phase 4 — Policy, CLI, and history

- [x] CLI foundation, bounded IPC requests, JSON/human output, and exit-code behavior.
- [x] `status`, `history`, `preview`, `mute`, `config`, and `doctor` command paths.
- [x] Host IPC contract and lifecycle wiring for doctor requests.
- [x] Quiet hours, DST handling, rate limits, coalescing, turn-end grace, and minimum duration.
- [x] Reminder planning and timer orchestration.
- [x] Subagent policy, privacy rendering, and retention scheduling.
- [x] Local dogfood statistics and journal template without telemetry.
- [x] F13 unsupported fallback documented and tested as non-suppressing.
- [x] Phase 4 acceptance matrix and final progress/plan reconciliation.
- [x] Phase 4 branch merged into `main` through PR #5.

## Verification and readiness

The merged Phase 4 branch recorded the following gates:

- [x] 51 test files passed.
- [x] 586 tests passed.
- [x] Workspace typechecks passed.
- [x] ESLint passed.
- [x] Dependency check passed.
- [x] Production build passed.
- [x] Reminder timer acceptance behavior verified.
- [x] Doctor IPC transport and unsupported focus behavior verified.

The repository is ready for the next planned milestone: a second adapter.
It is not yet a final multi-adapter release because Phase 5 and Phase 6 remain
open.

## PRD comparison: done versus remaining

| PRD scope | Current status | Notes |
| --- | --- | --- |
| F4/F5 notification rendering and provider delivery | Done | Providers, templates, mute/preview behavior, and delivery isolation are implemented and tested. |
| F6 toast delivery | Done for supported Windows path | Toast/provider coverage and delivery isolation are present. |
| F7 status/history | Done | Query models, storage contracts, and CLI-facing host paths are present. |
| F8 suppression, quiet hours, dedupe, coalescing, rate limits | Done | Core and integration evidence is recorded. |
| F9 failure alerts | Done | Failure state/precedence behavior is covered. |
| F10 turn-end alerts | Done | Grace/min-duration and state behavior are covered. |
| F11 CLI and doctor | Done for supported environments | Doctor transport, JSON/human paths, config, exit codes, and capability reporting are implemented. |
| F12 audio queue | Done | Queue, coalescing, and rate limiting are covered. |
| F13 focus awareness | Explicitly unsupported | No verified session-to-window mapping exists in the current event contract; alerts are never suppressed from guessed focus state. |
| F14 reminders | Done | Planning and timer firing are covered; host supplies runtime callback/timer ownership. |
| F15 privacy modes | Done | Standard/discreet rendering and metadata retention behavior are covered. |
| OpenCode first adapter | Done | Adapter, installer, fixtures, lifecycle, and live-smoke evidence are integrated. |
| Phase 5 second adapter | Remaining | No second host adapter has been integrated yet. |
| Phase 6 hardening and release | Remaining | Security review, clean-profile install verification, packaging, compatibility matrix, and release gates remain. |
| Dogfood outcome targets | Started, not closed | Local stats and journal are ready; actual multi-user/period outcome measurements are still future work. |

## Remaining work and recommended next steps

1. Implement and verify the second adapter under the Phase 5 plan, reusing the
   existing contract and core without host-specific changes.
2. Keep F13 disabled unless a future adapter supplies reliable session-window
   metadata; then add host-specific acceptance tests before enabling it.
3. Run Phase 6 security, packaging, clean Windows-profile, compatibility, and
   release verification.
4. Continue local dogfooding and record the PRD outcome signals before claiming
   the proposed noise/disablement targets.

## Traceability

- [PRD.md](PRD.md)
- [Master plan](docs/plans/00-master-plan.md)
- [Phase 3 progress](docs/phase-3-progress.md)
- [Phase 4 progress](docs/phase-4-progress.md)
- [Phase 4 acceptance matrix](docs/phase-4-acceptance.md)
- [Phase 4 implementation plan](docs/plans/05-phase-4-policy-cli-history.md)
