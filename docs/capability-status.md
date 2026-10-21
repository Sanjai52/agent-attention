# Agent Attention Capability Status

Status: verified MVP capability map, 2026-10-22.

This document separates observed behavior from fixture-only coverage and future
work. The PRD remains the source of truth; unsupported behavior must not be
described as available.

## Supported platform

| Area                     | Current support                                      |
| ------------------------ | ---------------------------------------------------- |
| Operating system         | Windows 10/11, native user sessions                  |
| Runtime                  | Node.js `>=24.20.0`                                  |
| Storage                  | Per-user SQLite state and history                    |
| User surface             | CLI, sound, voice, and Windows desktop notifications |
| Unsupported environments | WSL, SSH, dev containers, and remote workspaces      |
| Administrator rights     | Not required for the intended per-user installation  |

## Agent integrations

### OpenCode

Verified against OpenCode `v2.0.32`. This is the primary and most complete
integration.

| Capability                    | Status                           | Signal or evidence               |
| ----------------------------- | -------------------------------- | -------------------------------- |
| Session start                 | Supported, authoritative         | `session.execution.started`      |
| Coarse progress               | Supported, authoritative         | `session.step.started`           |
| Approval request              | Supported, authoritative         | `permission.asked`               |
| Approval resolution           | Supported, authoritative         | `permission.replied`             |
| Interrupted turn              | Supported, inferred              | `session.execution.interrupted`  |
| Successful completion         | Supported, authoritative         | `session.execution.succeeded`    |
| Failure                       | Supported, authoritative         | `session.execution.failed`       |
| Stable event IDs and ordering | Supported                        | Source IDs and durable sequence  |
| Concurrent sessions           | Supported                        | Live pre-testing evidence        |
| Subagents                     | Supported by capability contract | Parent/child session identity    |
| General blocking questions    | Unsupported                      | No verified authoritative signal |
| Resume signal                 | Unsupported                      | No verified host signal          |
| Session-ended signal          | Unsupported                      | No verified host signal          |

OpenCode live delivery, history persistence, completion, interruption,
concurrency, duplicate suppression, spool recovery, hostile-name handling,
mute, and preview paths were exercised during pre-testing.

### Claude Code

The adapter is verified against Claude Code `2.1.181`. A local `2.1.306`
runtime was exercised for hook delivery, but the full capability set has not
been revalidated against that newer runtime.

| Capability                            | Status                                  | Signal or evidence                  |
| ------------------------------------- | --------------------------------------- | ----------------------------------- |
| Session start                         | Supported, authoritative                | `SessionStart`                      |
| Approval request                      | Supported, authoritative but TUI-scoped | `PermissionRequest`                 |
| Approval resolution                   | Supported, inferred                     | `PostToolUse` after approval        |
| Turn ended                            | Supported, inferred                     | `Stop`; never treated as success    |
| Failure                               | Supported, authoritative                | `StopFailure`, `PostToolUseFailure` |
| Session ended                         | Supported, authoritative                | `SessionEnd`                        |
| Successful completion                 | Unsupported                             | No verified success hook            |
| Progress                              | Unsupported                             | No verified progress hook           |
| General blocking questions            | Unsupported                             | Not distinguishable from metadata   |
| Resume, sequence, subagents, liveness | Unsupported                             | No verified host support            |

The installer, asynchronous hook runner, normalization, fixture replay,
duplicate suppression, and `SessionStart` live path are implemented.

### Codex CLI and Gemini CLI

Neither integration is implemented. Their packages are placeholders only and
are not published or supported by the MVP.

## Core and delivery behavior that works

- Strict event validation and capability gating.
- Session state transitions, ordering, stale-state reconciliation, and
  deduplication.
- Quiet hours, mute, coalescing, rate limiting, reminders, and turn-end policy.
- SQLite persistence with a single Notification Host writer.
- Named-pipe IPC with spool fallback and restart reconciliation.
- Provider failure isolation across sound, voice, and toast.
- CLI status, history, preview, mute, config, doctor, install, and uninstall.
- Hostile-name and injection defenses across presentation and provider boundaries.
- 50-event pipe/SQLite storm persistence and replay deduplication.

## Known limitations and release gaps

- A second Windows build or clean VM is still required.
- Clean-profile install/uninstall evidence is not complete.
- True process-kill storm recovery and shim overhead remain unmeasured.
- Real hook-to-audible latency remains unmeasured with providers enabled.
- Focus suppression is unsupported for VS Code/OpenCode; only verified
  Windows Terminal/classic-console attribution is eligible.
- Same-user pipe spoofing remains the accepted D-15 MVP risk; spoofed input can
  create an alert/history record but cannot control an agent.
- Q-11 and Q-12 remain deferred pending dogfood evidence.
- Release-candidate packaging still needs clean-profile execution from packed
  artifacts.

## Evidence index

- [Host signal matrix](host-signal-matrix.md)
- [Pre-testing report](pre-testing-report.md)
- [Security review](security-review.md)
- [Performance report](performance-report.md)
- [Acceptance report](acceptance-report.md)
- [Compatibility matrix](compatibility.md)
- [Phase 6 implementation plan](plans/07-phase-6-hardening-release.md)

## Future work

Post-MVP work includes Codex/Gemini adapters, richer input and resume signals,
verified Claude completion, click-to-focus, broader focus attribution, remote
and WSL support, richer policy scopes, and a resident speech worker if the
release latency measurements require it.
