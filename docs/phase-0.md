# Phase 0 — Feasibility Spikes: Status Report

**Status: PARTIAL — PARKED, not complete.**
The Phase 0 exit gate (M0) has **not** been met. This document records what was
actually done, what remains, and why Phase 1 was allowed to proceed first.

| Item | Value |
|---|---|
| Plan | [`plans/01-phase-0-feasibility-spikes.md`](plans/01-phase-0-feasibility-spikes.md) |
| Branch | `phase-0-feasibility-spikes` (not merged) |
| Commits | `bc705ca` workspace + evidence logs; `fb08fd5` S1 evidence-standard fix |
| PRD gate | §20 M0 — D-01/D-03/D-04 decided, Q-05/Q-06/Q-07 answered, matrix written, schedule re-baselined |
| Executed | Task 0.1 only (spike workspace and evidence logs) |

## 1. Why Phase 0 exists

Phase 0 is the feasibility gate that must answer questions the PRD deliberately
left open before architecture is locked in:

| ID | Question | Gate it feeds |
|---|---|---|
| D-01 | Which host is the first adapter, scored against PRD §16.1? | Phase 3 (first adapter) |
| D-03 | Which process model: in-process plugin, hook process, extension, or shim + host? | Phase 2 (host/process wiring) |
| D-04 | Which SQLite binding: `node:sqlite`, `better-sqlite3`, or another? | Phase 2 (storage) |
| Q-05 | Which Windows toast/provider mechanism is reliable? | Phase 2/4 delivery |
| Q-06 | How is focus/Do-Not-Disturb detected without private APIs? | Phase 4 (F13) |
| Q-07 | Is click-to-focus reliable? | Phase 4 (F13) |
| Q-08 | Do candidate hosts expose stable event/session IDs? | Phase 3/5 adapters |

Without this evidence, adapter capability declarations and the process model
would be guesses. The PRD requires every spike result to be tagged
`[Verified]`, `[Assumption]`, or `[Rejected]` with raw evidence.

## 2. What was completed (Task 0.1)

Task 0.1 created the workspace, evidence logs, and the host-signal matrix. No
experiments were run and no host claim was verified.

### Created files

| File | Purpose |
|---|---|
| `spikes/README.md` | Phase 0 index: S1/S2/S3 questions, time boxes, method, evidence rules, "throwaway code — do not promote" rule |
| `spikes/s1-host-signals/README.md` | Host-signal spike: docs-first method, probe procedure, capture protocol, negative tests |
| `spikes/s2-process-model/README.md` | Process-model spike: pipe/host/shim/spool question, latency targets, SQLite binding question |
| `spikes/s3-windows-delivery/README.md` | Windows delivery spike: audio/TTS/toast/focus, suppression and terminal-closed runs |
| `docs/spikes/s1-results.md` | S1 evidence record format, ID scheme, tag rules, evidence checklist |
| `docs/spikes/s2-results.md` | S2 evidence record format, latency reporting rules (p50/p95, cold/warm) |
| `docs/spikes/s3-results.md` | S3 evidence record format, suppression/terminal-closed reporting rules |

### Modified file

`docs/host-signal-matrix.md` now has the PRD §16.1 criteria as 11 rows, one
column per candidate host (OpenCode, Claude Code, Codex, Gemini CLI), and all
44 cells set to `TBD`. It also defines the scoring rule: only `[Verified]`
evidence clears a cell.

### Evidence standard (after the fix round)

A record is `[Verified]` when it has **either**:

- an official documentation URL plus access date (doc-only records use
  `n/a (doc-only)` for build/tool versions and a verbatim quoted excerpt as the
  raw observation), **or**
- a local capture path plus a line reference.

Community examples and undocumented claims are `[Assumption]` and **cannot**
clear a matrix cell. `[Rejected]` records what was disproved. Every record uses
the six-field template: date/versions, method, raw observation, conclusion, tag.

Commit `fb08fd5` fixed a contradiction where the S1 log required local
reproduction while the matrix allowed doc-only evidence — a difference that
could have changed the authoritative count behind D-01.

### Verification performed

- `git show --stat bc705ca`: exactly 8 files (7 created, 1 modified), 503
  insertions, 17 deletions; worktree clean after commit.
- Matrix check against the committed blob: 11 criteria rows × 4 host columns,
  all 44 cells `TBD`.
- Each spike README contains the required question, time box, method,
  reproduction steps, and throwaway warning.
- All three result logs contain the exact six-field record template.
- `git check-ignore` confirms `spikes/**/out/` excludes probe artifacts.
- Fix round re-checked all four evidence-standard files in both the worktree and
  the committed blob.

## 3. What was not done

| Task | Deliverable | Status |
|---|---|---|
| 0.2 | OpenCode host signals (probe plugin, captures, matrix column) | Not started |
| 0.3 | Claude Code host signals | Not started |
| 0.4 | Third host (Codex or Gemini CLI) signals | Not started |
| 0.5 | S1 scorecard, D-01 decision, fixture capture | Not started |
| 0.6 | S2 process-model prototype (pipe/host/shim/latency) | Not started |
| 0.7 | S2 SQLite binding comparison | Not started |
| 0.8 | S3 audio playback prototype | Not started |
| 0.9 | S3 TTS prototype | Not started |
| 0.10 | S3 toast prototype + AUMID/registration | Not started |
| 0.11 | S3 focus detection + click-to-focus (Q-06/Q-07) | Not started |
| 0.12 | S3 notification-provider selection (Q-05) | Not started |
| 0.13 | Phase 0 exit review, PRD §23/§24 updates, re-baseline | Not started |

Consequences:

- **D-01, D-03, D-04 are still open.**
- **Q-05, Q-06, Q-07, Q-08 are still unanswered.**
- All 44 host-signal cells remain `TBD`.
- No fixture captured from a real host exists yet.
- No spike prototype code exists yet; `spikes/**/out/` is empty by design.

## 4. Why Phase 1 proceeded first

The master plan originally required Phase 0 before Phase 1 because the process
model can influence the pipeline's shape. That dependency does not apply to the
pure core:

- `packages/contract` and `packages/core` have no host, process, database, or
  Windows dependency.
- The pipeline takes storage, clock, capabilities, and rate limiter through
  injected interfaces, so the Phase 2 wiring can change without rewriting core
  logic.
- The user directed implementation to start while Phase 0 evidence was parked.

The master plan records this as an **execution exception**: Phase 1 may run in
parallel with Phase 0 evidence gathering, but **no adapter work (Phase 3+)
starts until Phase 0 closes D-01**. If S2 changes the process model, only the
Phase 2 wiring is reworked, not the pure core.

## 5. Rulings and deviations

| Ruling | Reason | Cost if wrong |
|---|---|---|
| Phase 0 parked after Task 0.1 | User redirected effort to product implementation; core has no host dependency | Adapter docs/fixtures need rework; core unaffected |
| Phase 0 branch not merged | Phase is incomplete; only complete phases merge to `main` | Phase 0 must be resumed from its branch or re-applied |
| Per-task reviewer subagents removed | User asked for less review overhead and phase-end testing | Defects surface at the phase boundary instead of per task |
| Workflow now merges only after explicit user confirmation | User instruction | No accidental merge |

## 6. How to resume Phase 0

1. Check out `phase-0-feasibility-spikes` (or re-apply `bc705ca` + `fb08fd5` if
   `main` has moved).
2. Execute Tasks 0.2–0.4 against the installed hosts, recording every result in
   `docs/spikes/s1-results.md` and filling the matrix cells.
3. Execute Task 0.5: score the matrix, decide D-01, and freeze captures under
   `tests/fixtures/<host>/`.
4. Execute Tasks 0.6–0.7: process-model and SQLite prototypes; record p50/p95
   latency and decide D-03/D-04.
5. Execute Tasks 0.8–0.12: audio, TTS, toast/AUMID, focus/click-to-focus, and
   provider selection; decide Q-05/Q-06/Q-07.
6. Execute Task 0.13: close the gate, update PRD §23/§24 in the same change,
   and re-baseline the schedule.
7. Run the full gate, raise the phase PR, and merge only after confirmation.

## 7. Known issues carried forward

1. **Time-box arithmetic:** the plan states a 5–7 working-day Phase 0 box, but
   the task boxes sum to at least 10 days (S1 4.5 + S2 2.5 + S3 3, excluding
   Task 0.5 scoring). Reconcile before tracking burn.
2. **Documentation index:** `docs/README.md` previously pointed the `spikes/`
   row at result records, which now live under `docs/spikes/`; corrected with
   this report.
3. **No evidence yet:** nothing in this phase should be read as a host
   capability claim. Every matrix cell is still `TBD`.
