# Phase 0–1 Context

**Purpose:** the single context document for a new human or agent picking up
this repository. It answers three questions:

1. What was Phase 0 supposed to inspect, and what was actually finished?
2. What did Phase 1 deliver, and how was it verified?
3. What is safe to build next, and what is still blocked?

Deep reports: [`phase-0.md`](phase-0.md) (spike status) and
[`phase-1.md`](phase-1.md) (delivery report). Source of truth remains
[`../PRD.md`](../PRD.md).

## 1. Status at a glance

| Phase | Status | Meaning |
|---|---|---|
| Phase 0 — feasibility spikes | **PARTIAL / IN PROGRESS** | Task 0.1 and Task 0.2 Step 1 (OpenCode official docs) are done. OpenCode is 10 `[Verified]` / 1 `[Assumption]`; the S1 probe and S2/S3 are pending. No gate decision has been made. |
| Phase 1 — contract & core | **COMPLETE and MERGED** | Contract, config, pure core, pipeline, replay harness, docs. `npm run ci` green. PR #1 merged as `92bae16`. |
| Phase 2 — host & providers | **Blocked** | Needs D-03/D-04/Q-05 from Phase 0; Q-06/Q-07 gate the focus task. The master plan forbids implementing around open gates. |
| Phase 3 — first adapter | **Blocked** | Requires D-01 (first host) and Q-08 (stable IDs) from Phase 0. |
| Phase 4 — policy, CLI, history | Not started | Depends on Phase 2. |
| Phase 5 — second adapter | Not started | Depends on Phase 4. |
| Phase 6 — hardening & release | Not started | Depends on all prior phases. |

```text
main (92bae16)                  <- Phase 1 merged (PR #1)
 └─ phase-0-feasibility-spikes  <- current branch, 4 ahead / 0 behind
    eac4ff5 docs(s1): OpenCode documentation evidence
```

Phase 1 is merged. The Phase 0 branch remains unmerged because its exit gate
has not been met.

## 2. Coding-agent inspection status (direct answer)

**OpenCode documentation inspection is complete; no capture session has run.
Claude Code, Codex, and Gemini CLI have not been inspected.**

Phase 0 S1 planned to inspect four candidate coding agents against the PRD
§16.1 criteria. Task 0.2 Step 1 collected official OpenCode documentation and
recorded 11 evidence records (`S1-01` … `S1-11`). The probe plugin, capture
sessions, negative tests, and the other host columns remain outstanding.

| Candidate host | Planned task | Docs collected | Probe built | Capture sessions | Negative tests | Matrix cells verified | Status |
|---|---|---|---|---|---|---|---|
| OpenCode | 0.2 | Yes | None | None | None | **10 / 11** (1 `[Assumption]`) | Docs done; probe pending |
| Claude Code | 0.3 | None | None | None | None | **0 / 11** | Not inspected |
| Codex | 0.4 candidate | None | None | None | None | **0 / 11** | Not inspected |
| Gemini CLI | 0.4 candidate | None | None | None | None | **0 / 11** | Not inspected |

The matrix has 11 criteria × 4 hosts = **44 cells**: OpenCode has 10
`[Verified]`, 1 `[Assumption]` (permission resolution), and the other 33 cells
are `TBD`.

`Approval signal`, `Resolution signal`, `Blocking input`, `Turn boundary`,
`Completion`, `Failure`, `Stable IDs / sequence`, `Subagents`, `Non-blocking`,
`Windows-native`, `Stability`.

What this means concretely:

- **D-01 (first host), D-03 (process model), D-04 (SQLite binding), Q-05
  (Windows delivery), Q-06/Q-07 (focus), and Q-08 (stable IDs across candidate
  hosts) are still open.**
- There are **no recorded host fixtures** for Phase 3 adapters.
- Phase 1 did **not** inspect or reverse-engineer any coding agent's internals.
  It was built from the PRD contract only. The pure core has no host dependency,
  which is why it could proceed without S1.

What does exist:

| Artifact | Where |
|---|---|
| OpenCode evidence records `S1-01` … `S1-11` | `docs/spikes/s1-results.md` |
| Matrix with the OpenCode column populated | `docs/host-signal-matrix.md` |
| Richer matrix with criterion questions, evidence standard, negative-test rules | `phase-0-feasibility-spikes` branch |
| Spike workspace and per-spike READMEs | `spikes/` on the phase-0 branch |
| Result-record templates | `docs/spikes/s1-results.md`, `s2-results.md`, `s3-results.md` on the phase-0 branch |

Do not cite the PRD's `[Assumption]` tags as inspection results. They remain
assumptions until the phase-0 evidence log says `[Verified]`.

## 3. Phase 0 — what was actually done

Phase 0's goal was to replace blocking assumptions with measured evidence and
close the feasibility gate (PRD M0). **Task 0.1** and **Task 0.2 Step 1** have
run.

### Deliverables on `phase-0-feasibility-spikes`

| Commit | Change |
|---|---|
| `bc705ca` | Added spike workspace, evidence logs, and the §16.1 matrix scaffold (8 files, 503 insertions) |
| `fb08fd5` | Fixed the S1 evidence standard so doc-only evidence and capture evidence are consistent |
| `7aa5d67` | Synced the Phase 0 branch with merged `main` |
| `eac4ff5` | Added OpenCode documentation evidence `S1-01` … `S1-11`; populated the OpenCode matrix column |

Files added on that branch:

- `spikes/README.md` — S1/S2/S3 index, time boxes, evidence rules, throwaway-code
  warning.
- `spikes/s1-host-signals/README.md` — host-signal question, docs-first method,
  probe procedure, capture sessions, negative tests.
- `spikes/s2-process-model/README.md` — pipe/host/shim/spool and latency
  question, SQLite binding question.
- `spikes/s3-windows-delivery/README.md` — audio/TTS/toast/focus prototypes and
  provider selection.
- `docs/spikes/s1-results.md`, `s2-results.md`, `s3-results.md` — six-field
  evidence-record templates; S1 now also contains `S1-01` … `S1-11`.
- `docs/host-signal-matrix.md` — 11 criteria, 4 hosts; OpenCode has 10
  `[Verified]` and 1 `[Assumption]`; the other 33 cells are `TBD`.

### Evidence standard created

A result is `[Verified]` only with **either** an official documentation URL plus
access date, **or** a local capture path plus a line reference. Community
examples and undocumented claims are `[Assumption]` and cannot clear a matrix
cell. `[Rejected]` records what was disproved. Every record carries date,
Windows build, tool versions, method, raw observation, conclusion, and tag.

### What was not done

| Spike | Tasks | Status |
|---|---|---|
| S1 host signals | 0.2 OpenCode (docs done; probe/captures pending), 0.3 Claude Code, 0.4 Codex/Gemini, 0.5 scorecard/D-01/fixtures | Partial |
| S2 process + storage | 0.6 process-model prototype, 0.7 SQLite binding | Not started |
| S3 Windows delivery | 0.8 audio, 0.9 TTS, 0.10 toast/AUMID, 0.11 focus/click-to-focus, 0.12 provider selection | Not started |
| Exit | 0.13 gate review, PRD §23/§24 updates, re-baseline | Not started |

The phase was parked after Task 0.1 and has been resumed. The branch keeps the
framework, and the OpenCode documentation pass is already committed.

### Why it was parked

The user redirected effort to product implementation. Phase 1 (contract + pure
core) has no host dependency, so the master plan records an **execution
exception**: Phase 1 may proceed while Phase 0 evidence is gathered. The
exception does **not** apply to adapters: Phase 3 cannot start until D-01 closes.

### Impact if Phase 0 stays open

- Phase 2 cannot start under the master plan's gate rule: D-03/D-04/Q-05 must
  be decided before host/process/storage/provider implementation.
- Phase 3 adapter work would be guesswork and may target the wrong host.
- F13 focus features cannot be implemented honestly (Q-06/Q-07).
- The Windows delivery guarantee (Q-05) remains unproven.

## 4. Phase 1 — what was finished

Phase 1 delivered the host-independent product core.

### Scope

- Strict event contract and adapter capability declaration.
- Config schema v2 with verbatim PRD defaults and per-key fallback.
- Pure core: ordering, state machine, task/subagent scope, dedupe, quiet hours,
  turn-end precedence, rate limiting/coalescing, reminders, staleness,
  templates/privacy, safe names.
- `processEvent` composition: validation → capability honesty → dedupe claim →
  event record → ordering → state → suppressors → plans/timers.
- Deterministic JSONL fixture format and replay harness.
- Contract, architecture, and phase reports.

### Task/commit map

| Task | Commit | Result |
|---|---|---|
| 1.1 Tooling baseline | `8c0239f` | Purity and dependency gates in CI |
| 1.2 Event/capability types | `e6a5e0f` | 11 event types, capability declaration |
| 1.4 Safe names | `cdfcd71` | Control/bidi stripping, 64 code points, voice allowlist |
| 1.3 Strict validation | `32492dc` | Zod 4 schema, required details, structured issues |
| 1.5 Config | `aaf9e59` | Defaults, per-key fallback, diagnostics |
| 1.7 State machine | `eaf9bb1` | `applyEvent`, requests, terminal resume |
| 1.6 Ordering | `ba144c7` | Sequence/time/receipt/eventId; late closures |
| 1.8 Tasks/subagents | `5938140` | Scope, `affectsParent`, unknown parents |
| 1.9 Fingerprints | `e0fb50d` | Three rules, time buckets, adjacent bucket |
| 1.10 Quiet hours | `6767146` | Cross-midnight, per-channel flags |
| 1.11 Templates/privacy | `3012b4c` | Controlled wording, discreet mode, speech safety |
| 1.12 Turn-end | `e5862d2` | Grace, min duration, subagent suppression |
| 1.13 Rate limit/coalesce | `f34abd5` | 60 s window, priority, 30 s bypass |
| 1.14 Reminders | `3803b93` | Due times, max reminders |
| 1.15 Staleness | `5865c2c` | Working/waiting, closed requests, restart reconcile |
| 1.16 Pipeline | `9b99da0` | Full composition, plans, timers, coalesced summary |
| 1.17 Fixture replay | `3aa13b3` | Loader, synthetic session, dedupe-across-runs |
| 1.18 Exit verification | `6c0ab61` + `1151a40` | Docs, coverage audit, volume-independence test |

### Verification

```text
npm run ci  ->  exit 0
lint        ->  pass
deps:check  ->  no issues
typecheck   ->  root + 11 workspaces pass
tests       ->  19 files, 310 tests pass
build       ->  all workspaces pass
```

Synthetic replay: `started → progress → needs_input → resumed → completed`
ends `completed/authoritative` with no pending requests. Replaying the same
stream twice produces no second notifications.

PRD §19.1 core areas are covered. Two non-core areas are deferred with owners:
DST integration (Phase 4 Task 4.8) and runtime volume application/audio queue
(Phase 2). Volume independence is covered at the config layer.

### Core invariants Phase 2 must preserve

- `packages/core` stays pure: no I/O, database, timers, Windows APIs.
- Persistence precedes dispatch; a failed notification cannot erase an event.
- Duplicates stop before any state change, plan, or timer.
- Progress is liveness only: never stored or fingerprinted.
- Late request closures apply but never notify.
- Plans and timer instructions are data; the host executes them.
- No free text crosses the event contract.
- Capability honesty is enforced; an adapter cannot claim authoritative support
  for an inferred signal.

## 5. What is finished vs open

### Finished

- [x] Phase 1 contract, config, pure core, pipeline, replay harness.
- [x] Phase 1 gate: 310 tests, lint, typecheck, build.
- [x] Contract and architecture documentation.
- [x] Phase 0 and Phase 1 status reports.
- [x] Phase 1 master-plan checkbox.

### Open

- [ ] Phase 0 OpenCode probe and captures (0.2 Steps 2–6).
- [ ] Phase 0 Claude Code and third-host inspections (0.3–0.5).
- [ ] Phase 0 process/storage evidence (0.6–0.7) — D-03/D-04.
- [ ] Phase 0 Windows delivery evidence (0.8–0.12) — Q-05/Q-06/Q-07.
- [ ] Phase 0 exit and re-baseline (0.13).
- [ ] D-01 first host; Q-08 stable IDs.
- [ ] Phase 2 host/providers (blocked on Phase 0 gates).
- [ ] Phase 3 adapters (blocked on D-01/Q-08).
- [ ] `waitingAfterHours` config decision (Phase 4).
- [ ] Ended-session ID reuse policy (Phase 2).
- [ ] Focus awareness and click-to-focus (Phase 2/4 after Q-06/Q-07).

## 6. Rules that govern the next work

1. **PRD is authoritative.** If a document disagrees, fix the document in the
   same change. Behavior changes update PRD §23/§24.
2. **One branch per phase**, named `phase-<n>-<kebab-name>`, cut from updated
   `main`. Never work on `main`.
3. **Continuous execution.** Do tasks in sequence; stop only for a real blocker
   (missing credentials/tools, ambiguous spec, destructive action). Do not pause
   for per-task review ceremonies.
4. **Phase gate at the end.** Run `npm run ci` plus the phase's exit criteria,
   fix all failures, then raise the PR.
5. **Merge only with explicit user confirmation**, using the PR flow; never
   force-push or squash away task history.
6. **Do not implement around an open gate.** No adapter work before D-01; no
   invented focus detection before Q-06; no invented process model before D-03.
7. **Keep the core pure.** `tests/unit/tooling/purity.test.ts` is the guard.
8. **Do not treat `TBD` as verified.** A matrix cell needs `[Verified]` evidence
   per the phase-0 standard.

## 7. Where to look

| Need | File |
|---|---|
| Product requirements | [`../PRD.md`](../PRD.md) |
| Phase map, gates, branch/PR process | [`plans/00-master-plan.md`](plans/00-master-plan.md) |
| Phase 0 plan | [`plans/01-phase-0-feasibility-spikes.md`](plans/01-phase-0-feasibility-spikes.md) |
| Phase 1 plan | [`plans/02-phase-1-contract-and-core.md`](plans/02-phase-1-contract-and-core.md) |
| Phase 0 status report | [`phase-0.md`](phase-0.md) |
| Phase 1 delivery report | [`phase-1.md`](phase-1.md) |
| Host inspection matrix | [`host-signal-matrix.md`](host-signal-matrix.md) |
| Event/config contract | [`event-contract.md`](event-contract.md) |
| Core architecture | [`architecture.md`](architecture.md) |
| Pipeline entry point | `../packages/core/src/pipeline/process-event.ts` |
| Contract entry point | `../packages/contract/src/index.ts` |
| Tests | `../tests/unit/` |
| Phase 0 branch artifacts | `phase-0-feasibility-spikes`: `spikes/`, `docs/spikes/`, richer matrix |

## 8. Commands

```bash
# Verify merged main or the Phase 0 branch
npm ci
npm run ci

# Focused suites
npx vitest run tests/unit/core/pipeline.test.ts
npx vitest run tests/unit/core/replay.test.ts
npx vitest run tests/unit/tooling/purity.test.ts

# Inspect branch state
git branch --show-current
git log --oneline main..HEAD
git status --short
```

## 9. Recommended next actions

1. **Phase 1 is delivered and merged.** PR #1 is closed; `main` is `92bae16`.
2. **Finish Phase 0 before Phase 2:** check out `phase-0-feasibility-spikes`,
   complete the OpenCode probe and captures, inspect Claude Code and a third
   host, then execute S2/S3 (0.6–0.12) and close 0.13. Fill the matrix only with
   `[Verified]` evidence.
3. **Do not start Phase 2 while D-03/D-04/Q-05 are open.** The master plan
   forbids implementing around an undecided gate. Phase 2 is cut from updated
   `main` after Phase 0 merges.
4. **Do not start Phase 3** until D-01 is decided and Q-08 is answered.
