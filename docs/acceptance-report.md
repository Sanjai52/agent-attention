# Phase 6 acceptance report

Status: **acceptance sweep integrated; release sign-off pending**
Branch: `main` (Phase 6 merged)
Date: 2026-10-22
Scope: PRD §19.2 scenarios A–Q and PRD §21.1 Definition of Done

## Evidence

The automated sweep is in [`tests/acceptance/scenarios.test.ts`](../tests/acceptance/scenarios.test.ts). It exercises the deterministic core with an in-memory store, injected clock, fake quiet-hour clock, and stubbed policy dependencies. It does not claim live Windows-provider or clean-profile evidence.

| Scenario                    | Result  | Evidence / limitation                                                                                                                                   |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Blocking question       | PASS    | Automated authoritative `needs_input` pipeline test                                                                                                     |
| B — Ordinary progress       | PASS    | Automated no-alert/liveness test                                                                                                                        |
| C — Approval                | PASS    | Automated approval priority/state test; host execution remains outside the core                                                                         |
| D — Completion              | PASS    | Automated verified session completion test                                                                                                              |
| E — Concurrent agents       | PASS    | Automated independent-session test                                                                                                                      |
| F — Quiet hours             | PASS    | Automated suppression/history test                                                                                                                      |
| G — Duplicates              | PASS    | Automated fingerprint/deduplication test                                                                                                                |
| H — Notification failure    | PARTIAL | Persistence and planned-channel behavior automated; live provider failure isolation remains covered by provider tests/manual evidence                   |
| I — Uncertain state         | PASS    | Automated `state_unknown` test                                                                                                                          |
| J — Idle only               | PASS    | Automated inferred `turn_ended`/non-success test                                                                                                        |
| K — Classified beats idle   | PASS    | Automated grace-window precedence test                                                                                                                  |
| L — Failure                 | PASS    | Automated failed-state and resumable-session test                                                                                                       |
| M — Denial                  | PASS    | Automated approval closure test                                                                                                                         |
| N — Storm                   | PARTIAL | 50-event deterministic burst acceptance and complete-history checks automated; alert-bound and real pipe/SQLite/mid-storm kill remain Task 6.4 evidence |
| O — Hostile project name    | PASS    | Automated inert template rendering; full sink injection matrix belongs to Task 6.1                                                                      |
| P — Restart                 | PASS    | Automated restart reconciliation; live process/spool replay remains Task 6.4 evidence                                                                   |
| Q — Unsupported environment | MANUAL  | Requires `doctor` runs in WSL/SSH/container environments; tracked as a Vitest todo                                                                      |

## Q-01–Q-13 status

| Question | Status                   | Evidence / rationale                                                                                                                                    |
| -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-01     | Answered                 | S1 evidence: OpenCode has the most reliable lifecycle signals                                                                                           |
| Q-02     | Answered                 | S1 evidence: typed permission requests are distinguishable; dedicated question tool remains capability-gated                                            |
| Q-03     | Answered                 | S1 evidence: evaluated hosts expose session-level completion only                                                                                       |
| Q-04     | Answered with scope      | OpenCode runtime and Node host validated; other host-specific compatibility remains Phase 6 packaging evidence                                          |
| Q-05     | Answered                 | S3 provider selection; second-build/third-party EDR validation remains residual evidence                                                                |
| Q-06     | Answered with scope      | Windows Terminal/classic console supported; VS Code attribution unsupported                                                                             |
| Q-07     | Deferred                 | Click-to-focus is intentionally out of MVP because real toast activation was not verified                                                               |
| Q-08     | Answered                 | Stable OpenCode IDs and sequence; Claude lacks a sequence and uses available IDs                                                                        |
| Q-09     | Answered                 | Host restart reconciliation, stale state, and idempotent spool rules are implemented and tested                                                         |
| Q-10     | Deferred to M3           | Host-native packaging/versioning is not an MVP gate                                                                                                     |
| Q-11     | Deferred pending dogfood | `docs/dogfood-journal.md` contains no measured dogfood entries; retain `minTurnSeconds=15` and `graceMs=1000` as current defaults until evidence exists |
| Q-12     | Deferred pending dogfood | `docs/dogfood-journal.md` contains no measured dogfood entries; reminders remain disabled by default per D-12                                           |
| Q-13     | Deferred optional        | CLI is the MVP activity surface per D-07; no host-native history panel is required                                                                      |

## Definition of Done checklist

| DoD area                                   | Status    | Blocking evidence                                                                       |
| ------------------------------------------ | --------- | --------------------------------------------------------------------------------------- |
| A–Q acceptance coverage                    | PARTIAL   | Q needs manual environment transcript; H/N/P need live/provider evidence                |
| Security and injection review              | OPEN      | Task 6.1                                                                                |
| Clean-profile admin-free install/uninstall | OPEN      | Task 6.2                                                                                |
| Release packaging and compatibility matrix | OPEN      | Task 6.3                                                                                |
| Storm and crash/recovery measurements      | OPEN      | Task 6.4                                                                                |
| Documentation truthfulness                 | OPEN      | Task 6.6                                                                                |
| Open questions                             | RECORDED  | Q-11/Q-12 explicitly deferred pending dogfood; remaining questions answered or deferred |
| Release candidate and tag                  | NOT READY | Blocked by the open evidence above                                                      |

## Automated versus manual work

Automated in this workstream: deterministic state transitions, policy precedence, quiet hours, deduplication, session isolation, restart projection, hostile template rendering, and a 50-event in-memory burst with complete processing/history checks.

Manual or owned by other Phase 6 workstreams: Windows provider failure isolation, WSL/SSH/container `doctor` detection, clean-profile install/uninstall, real pipe and SQLite storm behavior, kill/restart spool recovery, second-build validation, injection sinks, packaging, and release-candidate verification.

## Blockers

This report is not release approval. Phase 6 hardening is integrated into
`main`; the remaining blockers are the open evidence items listed in the DoD
table, plus the manual Q scenario. Release approval still requires explicit
owner sign-off after those gates are closed.
