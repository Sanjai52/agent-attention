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
| Phase 0 — feasibility spikes | **COMPLETE; merge waits for approval** | D-01/D-03/D-04 decided; Q-05/Q-06/Q-07 answered; OpenCode fixtures frozen; schedule re-baselined. Full report: [`phase-0.md`](phase-0.md). |
| Phase 1 — contract & core | **COMPLETE and MERGED** | Contract, config, pure core, pipeline, replay harness, docs. `npm run ci` green. PR #1 merged as `92bae16`. |
| Phase 2 — host & providers | **READY** | Phase 0 closed D-03/D-04/Q-05; Q-06 gates only the focus task. Cut from updated `main` after Phase 0 merges. |
| Phase 3 — first adapter | **Blocked on Phase 2** | D-01 selects OpenCode; Q-08 answered. The adapter contract can be designed now, but live wiring needs the Phase 2 host/provider layer. |
| Phase 4 — policy, CLI, history | Not started | Depends on Phase 2. |
| Phase 5 — second adapter | Not started | Depends on Phase 4; Claude Code is the likely second host (4/5). |
| Phase 6 — hardening & release | Not started | Depends on all prior phases. |

```text
main (92bae16)                  <- Phase 1 merged (PR #1)
 └─ phase-0-feasibility-spikes  <- current branch, 8 probe merges
    7be5303 merge: s2 process model probe
    797e2c0 merge: s3 focus probe
    948aced merge: s3 toast probe
    0f05b28 merge: opencode runtime signal probe
    30c9f40 merge: claude code signal probe
    6706683 merge: s3 audio and tts probes
    eb9edcc merge: codex signal probe
    ebf231e merge: s2 sqlite probe
```

Phase 1 is merged. The Phase 0 branch is complete but remains unmerged until the
user verifies the evidence and approves the merge.

## 2. Coding-agent inspection status (direct answer)

**All three evaluated hosts were inspected at runtime; Gemini CLI was not
evaluated.** OpenCode, Claude Code, and Codex CLI are in the matrix. The
OpenCode column is complete and selected; Claude Code is 4/5; Codex is 2/5 with
the approval runtime capture explicitly blocked.

| Candidate host | Planned task | Docs | Probe | Capture sessions | Negative test | Matrix cells | Status |
|---|---|---|---|---|---|---|---|
| OpenCode v2.0.32 | 0.2 | Yes | Yes | 7 scenarios | Pass | 11/11 filled, 5/5 scored | **D-01 selected** |
| Claude Code 2.1.181 | 0.3 | Yes | Yes | TUI hooks + permission | Pass | 11/11 filled, 4/5 scored | Second-host candidate |
| Codex CLI 0.155.1 | 0.4 | Yes | Yes | Turn-end + subagent | Pass | 11/11 filled, 2/5 scored | Approval runtime blocked |
| Gemini CLI 0.42.0 | 0.4 candidate | Not evaluated | No | No | No | 0/11 | Not evaluated |

D-01 and the Q-01/Q-02/Q-03/Q-08 list are answered in
[`spikes/s1-results.md`](spikes/s1-results.md). The scorecard is in
[`host-signal-matrix.md`](host-signal-matrix.md).

| Artifact | Where |
|---|---|
| All S1 evidence records | `docs/spikes/s1-results.md` |
| Matrix and D-01 scorecard | `docs/host-signal-matrix.md` |
| OpenCode runtime probe | `spikes/s1-host-signals/opencode/` |
| Claude Code probe | `spikes/s1-host-signals/claude-code/` |
| Codex probe | `spikes/s1-host-signals/codex/` |
| Frozen OpenCode fixtures | `tests/fixtures/opencode/` |
| S2 process/storage evidence | `docs/spikes/s2-results.md`, `spikes/s2-process-model/` |
| S3 delivery evidence | `docs/spikes/s3-results.md`, `spikes/s3-windows-delivery/` |

## 3. Phase 0 — what was actually done

Phase 0 replaced the blocking assumptions with measured evidence and closed
the M0 gate. The full report is [`phase-0.md`](phase-0.md).

| Task | Deliverable | Status |
|---|---|---|
| 0.1 | Spike workspace, evidence logs, matrix scaffold | Complete |
| 0.2 | OpenCode runtime signals, negative test, fixtures | Complete |
| 0.3 | Claude Code hooks and permission dialog | Complete with OAuth-mock limit |
| 0.4 | Codex hooks, turn-end, subagent | Complete; approval runtime blocked |
| 0.5 | Scorecard, D-01, fixtures, Q-01/02/03/08 | Complete |
| 0.6 | Process model, pipe, shim, spool, crash recovery | Complete; cross-user/post-reboot blocked |
| 0.7 | SQLite binding comparison | Complete; D-04 |
| 0.8 | Audio routes and hostile/failure paths | Complete; no-device arm blocked |
| 0.9 | TTS via stdin, hostile string, cancellation | Complete; zero-voice arm not available |
| 0.10 | AUMID registration, toast, suppression, cleanup | Complete with DND-on/second-build limits |
| 0.11 | Focus detection and click-to-focus | Partial; Q-06 answered, Q-07 deferred |
| 0.12 | Provider selection | Complete; Q-05 |
| 0.13 | Exit review, PRD updates, re-baseline | Complete |

`npm run ci` is the phase gate; the final run is recorded in the Phase 0 merge
review. The fixtures are sanitized OpenCode JSONL captures with a README and
expected normalized event lists.

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

- [x] Phase 0: D-01, D-03, D-04 decided; Q-05, Q-06, Q-07 answered.
- [x] Phase 0: host matrix, scorecard, OpenCode fixtures, re-baseline.
- [x] Phase 1 contract, config, pure core, pipeline, replay harness.
- [x] Phase 1 gate: 310 tests, lint, typecheck, build.
- [x] Contract and architecture documentation.
- [x] Phase 0 and Phase 1 status reports.

### Open

- [ ] Phase 2 host/providers (ready; cut after Phase 0 merge).
- [ ] Phase 3 OpenCode adapter (after Phase 2).
- [ ] Phase 4 policy/CLI/history; F13 only for WT/classic console; task 4.9
  click-to-focus deferred.
- [ ] Phase 5 second adapter; Claude Code is the likely choice.
- [ ] Phase 6 hardening/release.
- [ ] Residual validation, not gates: Claude Code OAuth/model captures, Codex
  approval runtime, audio no-device, zero-voice TTS, DND-on toast, second
  Windows build, cross-user pipe connect, post-reboot idle exit, third-party
  EDR, real toast-activation focus.

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

1. **Verify the Phase 0 evidence and approve the merge.** The full report is
   [`phase-0.md`](phase-0.md); the decision register is PRD §23.
2. **Merge `phase-0-feasibility-spikes` into `main` with `--no-ff`** after
   approval. Never force-push or squash the probe history.
3. **Cut `phase-2-host-and-providers` from updated `main`.** Implement the
   D-03 process model, D-04 storage, and Q-05 providers. Add the production
   native ACL helper and validate the koffi packaged install.
4. **Start Phase 3 only after Phase 2.** OpenCode is D-01; use the frozen
   fixtures and runtime names, not the V2 documentation examples.
5. **Keep the residual validation list visible** in the phase-2/3 plans. Do not
   turn blocked items into capability claims.
