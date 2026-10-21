# Agent Attention — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase plan task-by-task. Steps in the phase plans use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Agent Attention MVP exactly as specified in `PRD.md` v2.1 — a Windows-native, plugin-first notification ecosystem for coding agents — through eight gated phases.

**Architecture:** Thin host adapters normalize host lifecycle signals into the shared `AgentEvent` contract; a pure TypeScript core owns validation, ordering, state, dedupe, policy, and timing; a headless Notification Host is the single SQLite writer and dispatches through isolated sound/voice/toast providers over a current-user named pipe; a CLI is the only activity surface.

**Tech Stack:** TypeScript, Node.js 24 LTS (tested 24.20.0; `>=24.20.0 <25`), npm workspaces, Vitest, tsup, Zod, built-in `node:sqlite` (D-04), Windows named pipes (D-03), MCI/koffi sound with SoundPlayer fallback, fixed SAPI TTS over stdin, per-user AUMID + WinRT toast (Q-05).

**Spec:** `PRD.md` (source of truth). If a plan and the PRD disagree, the PRD wins; fix the plan in the same change and update PRD §24.

---

## Global Constraints

Copied from PRD; every task inherits these.

- **Platform:** Windows 10/11 with native agent processes only. WSL, SSH, dev containers, and remote workspaces are unsupported; `doctor` must detect and report them (D-09).
- **No standalone desktop app:** no window, tray icon, or persistent UI; CLI only (D-07).
- **No preferences in the database.** Preferences live only in `%APPDATA%\AgentAttention\config.json`; state/history in `%LOCALAPPDATA%\AgentAttention\` (D-05).
- **Single SQLite writer:** only the Notification Host opens the database (D-04).
- **No free text from agents** anywhere in events, history, notifications, or logs; wording comes only from the enumerated templates in PRD §14.3 (D-16).
- **Honest signals:** classified events require authoritative host signals; inferred events never imply success (PRD §1.5, D-02).
- **Non-blocking shim:** bounded runtime ≤ 1000 ms, never a blocking exit code, spool fallback on unreachable pipe (PRD §9.2).
- **No admin rights** for `install`/`uninstall`; merge-never-overwrite host config with timestamped backups (PRD §18.4).
- **Injection safety:** never build shell, PowerShell, or toast markup by string interpolation of event-derived values; hostile-name fixtures are mandatory (PRD §17.2).
- **Defaults that must match PRD §8.3 exactly:** volumes and soundIds per event; `minTurnSeconds: 15`; `graceMs: 1000`; `audio.maxQueueLength: 3`; `maxAlertsPerMinute: 6`; `coalesceWindowSeconds: 5`; `deduplication.fallbackWindowSeconds: 30`; `stale.workingAfterMinutes: 15`; `stale.waitingAfterHours: 12`; `reminders.enabled: false`, `afterMinutes: 10`, `maxReminders: 1`; `activityHistory.retentionDays: 7`.
- **Performance targets (PRD §19.3):** receipt-to-dispatch p95 < 500 ms; shim overhead p95 < 300 ms (cap 1000 ms); hook-to-audible p95 < 2 s.
- **Commits:** one commit per task, conventional prefix (`feat:`, `test:`, `docs:`, `chore:`), tests and code in the same commit.
- **PRD-first:** any behavior change updates `PRD.md` (§23 decision register and §24 change log) in the same change.

## Phase Map

| Phase | Branch | Plan file | PRD milestone | Exit gate |
|---|---|---|---|---|
| 0 — Feasibility spikes | `phase-0-feasibility-spikes` | `01-phase-0-feasibility-spikes.md` | M0 | D-01/D-03/D-04 decided, Q-05/Q-06/Q-07 answered, host-signal matrix written, schedule re-baselined |
| 1 — Contract & core | `phase-1-contract-and-core` | `02-phase-1-contract-and-core.md` | M1 | All PRD §19.1 unit areas pass; synthetic fixture streams produce correct states without duplicate processing |
| 2 — Host & providers | `phase-2-host-and-providers` | `03-phase-2-host-and-providers.md` | M2 | Providers fail independently; hostile-name tests pass; crash/restart/single-instance tests pass |
| 3 — First adapter | `phase-3-first-adapter` | `04-phase-3-first-adapter.md` | M3 | Adapter detects its declared events on recorded fixtures and live smoke; capability declaration matches measured behavior |
| 4 — Policy, CLI, history | `phase-4-policy-cli-history` | `05-phase-4-policy-cli-history.md` | M4 | F4–F15 acceptance criteria pass for supported capabilities; dogfooding starts |
| 5 — Second adapter | `phase-5-second-adapter` | `06-phase-5-second-adapter.md` | M5 | Second adapter reuses the core with no core changes beyond contract-level fixes |
| 6 — Hardening & release | `phase-6-hardening-release` | `07-phase-6-hardening-release.md` | M6 | PRD §21.1 Definition of Done satisfied on a clean Windows profile |

Phases 0–2 are complete. Phase 2→3 are strictly sequential. Phase 4 may overlap Phase 3's live-smoke work. Phase 5 requires Phase 4's CLI for install/uninstall verification. Phase 6 requires all acceptance scenarios.

**Execution exception:** Phase 1 (contract + pure core) has no host dependency, so it may proceed in parallel with Phase 0 evidence gathering. No adapter work (Phase 3+) starts until Phase 0 closes D-01. If S2 changes the process model mid-flight, only Phase 2 wiring is reworked, not the pure core.

## Branch, PR, and Merge Workflow

This is the binding delivery process for every phase.

1. **One phase per branch.** Cut the branch from an up-to-date `main` only after the previous phase has been merged. Never start a phase on `main`.
2. **Branch names identify the phase:** `phase-<n>-<kebab-phase-name>` (exact names in the Phase Map above). No `feat/`, `feature/`, ticket numbers, personal names, or vague names — the branch name alone must say which phase it delivers.
3. **Combined phases.** If two phases must run concurrently (e.g., 4 and 5), they share one branch named for both: `phase-4-5-<combined-kebab-name>`. Never run two parallel branches whose work will conflict at merge time.
4. **All phase work lands on the branch:** implementation, tests, fixtures, and the phase's docs. `main` receives only completed-phase merges and process docs (like this one).
5. **Execution is continuous.** Implement tasks one after another without pausing for per-task review ceremonies. Related tasks may be batched into one implementer dispatch. Stop only for a genuine blocker (missing credentials/tools, ambiguous spec, destructive action) — not to ask permission to continue.
6. **Phase completion = end-to-end verification on the branch.** When all tasks are implemented, run the full test/build gate (`npm run ci`) plus the phase's exit criteria from its plan file, and fix every failure. This is the bug-check gate: tests, typecheck, lint, and manual smoke where the plan calls for it. Do not open a PR with a red gate.
7. **Raise the PR:** push the branch, then `gh pr create` with title `phase <n>: <phase name>` and a body containing scope, task list, and test/verification evidence.
8. **Merge only after explicit confirmation.** Present the PR URL, the test evidence, and any known gaps to the user; wait for their approval, then `gh pr merge <n> --merge --delete-branch`. Never force-push, never squash away task history, never merge with red CI, and never merge on your own initiative.
9. **Then continue:** `git checkout main && git pull`, cut the next phase branch, and repeat. Do not continue work on a merged branch.

Per-task reviewer subagents are not part of this workflow. Reviews are a phase-boundary activity: one focused review pass after the tests pass, before the PR, and only if the user asks for it.

## Decision Gates

| Gate | Decided by | Blocks |
|---|---|---|
| D-01 first host | S1 scorecard (0.5) | Phase 3 |
| D-03 process model, D-04 SQLite binding | S2 (0.6, 0.7) | Phase 1 interfaces, Phase 2 |
| Q-05 audio/TTS/toast mechanism | S3 (0.8–0.12) | Phase 2 providers |
| Q-06/Q-07 focus & click-to-focus; F13 viability | **S3 (0.11): Q-06 answered (WT/classic console only); Q-07 deferred** | F13 tasks in Phases 2 and 4; task 4.9 cut until re-probed |
| Q-04 runtime compatibility | S1/S2 | Phase 3 packaging |
| Q-08 stable IDs | S1 | Phase 1 fingerprint assumptions, Phase 3 fixtures |

No phase may implement around an undecided gate; the spike output lands in `docs/` and `PRD.md` §23 first.

## Traceability — Features to Tasks

| Feature / requirement | Planned in |
|---|---|
| F1 needs_input (+F1-R9/R10) | 1.7, 1.16, 3.4, 4.8 |
| F2 completion (task/session, subagent rules) | 1.7, 1.8, 3.5, 3.6 |
| F3 approval (+resolution, no payloads) | 1.3, 1.7, 3.3, 2.9 |
| F4 sounds/volume/mute | 1.5, 2.8, 2.10, 4.5, 4.6 |
| F5 voice | 1.11, 2.9, 2.11 |
| F6 desktop toasts (+F6-R9..R11) | 2.9, 2.12, 4.7 |
| F7 history/status/staleness | 1.15, 2.1, 2.2, 4.3, 4.4 |
| F8 quiet hours & dedupe | 1.8, 1.9, 1.16, 4.8 |
| F9 failure (+cancelled default) | 1.7, 3.5, 4.8 |
| F10 turn_ended (+grace/min duration) | 1.12, 3.5, 4.8 |
| F11 CLI (status/history/preview/doctor/install/mute/config) | 4.1–4.7, 3.7 |
| F12 queue/coalescing/rate limiting | 1.13, 2.8, 4.8 |
| F13 focus awareness (S3-gated) | 2.13, 4.9 |
| F14 reminders | 1.14, 4.10 |
| F15 privacy modes | 1.11, 4.11 |
| Security & injection (PRD §17) | 1.4, 1.11, 2.10–2.12, 6.1 |
| Install/uninstall without admin (PRD §18.4) | 3.7, 6.2 |
| Testing strategy (PRD §19.1) | Task 1.17 + every phase's test suite |
| Acceptance scenarios A–Q (PRD §19.2) | 4.15, 6.5 |
| Success metrics (PRD §19.3) | 2.14, 3.8, 6.4 |

## Review Focus

Five failure classes the PRD implies but no single task's happy-path tests exercise. Each has a named test owned by a task below (indicated by `RF<n>` tags in the phase plans).

- **RF1 — Agent-derived strings are hostile.** A repository can be named `"; rm -rf ~ #` or contain RTL overrides; notifications, speech, and toast markup must stay inert and correctly rendered. (Owner: 1.4, 1.11, 2.10–2.12, 6.1.)
- **RF2 — Duplicate and out-of-order delivery.** The same signal may arrive twice, late, or replayed from spool; exactly one alert, one state change, no timer restarts. (Owner: 1.6, 1.8, 1.16, 2.7.)
- **RF3 — Time is not simple.** Quiet hours cross midnight and DST; timestamps may be untrustworthy; sequence numbers may be absent; the machine may change timezone while running. (Owner: 1.6, 1.9, 1.15.)
- **RF4 — The Windows delivery surface is unreliable.** Audio devices disappear, TTS voices are missing, toasts are suppressed by Focus Assist, and the host may be killed mid-write. (Owner: 2.3–2.12, 2.14.)
- **RF5 — Install/uninstall must be surgery.** Host config files may already contain user entries, may be edited concurrently, and `uninstall` must remove exactly what `install` added. (Owner: 3.7, 5.3, 6.2.)

Phase plans may add phase-local `RFn` items (e.g., RF6–RF11 in Phases 3–6); those are scoped to that phase and do not redefine the global five above.

## Risk Watchlist (execution-time)

| Risk | Where handled |
|---|---|
| Host API undocumented or changes mid-phase | 0.2–0.4 evidence; 3.2 capability downgrade rule; 5.5 contract tests |
| SQLite native module friction | 0.7 binding choice; 2.1 tests on clean profile |
| Toast path dead-ends for unpackaged apps | 0.10; if it fails, F6-R9 fallback is a documented PowerShell/third-party route decided in Q-05 |
| Alert fatigue from turn_ended | 1.12 + 4.8 tuned defaults; Q-11 dogfood |
| Schedule slip | M0 re-baseline (0.13) |

## Progress

- [x] Phase 0 — Feasibility spikes (report: [`../phase-0.md`](../phase-0.md); branch kept after merge)
- [x] Phase 1 — Contract & core (report: [`../phase-1.md`](../phase-1.md))
- [x] Phase 2 — Host & providers (report: [`../phase-2.md`](../phase-2.md))
- [x] Phase 3 — First adapter (report: [`../phase-3-progress.md`](../phase-3-progress.md); OpenCode adapter and installer worktrees)
- [ ] Phase 4 — Policy, CLI, history
- [ ] Phase 5 — Second adapter
- [ ] Phase 6 — Hardening & release
