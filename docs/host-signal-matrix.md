# Host Signal Matrix (S1)

Status: all three evaluated hosts recorded; OpenCode runtime probe complete.
D-01 selects OpenCode (5/5). See `spikes/s1-results.md` S1-12–S1-21.

Every cell starts as `TBD`. A cell clears `TBD` with `[Verified]` evidence: an
official documentation URL with access date, or a capture file under
`spikes/s1-host-signals/out/` with a line reference. Documentation-only evidence
is valid; for example, `Stability` can only be established from docs. Community
examples or undocumented claims are `[Assumption]` and do not score.

## §16.1 criteria

| Criterion | Question | OpenCode | Claude Code | Codex | Gemini CLI |
|---|---|---|---|---|---|
| Approval signal | Is there an authoritative, documented permission-request signal? | [Verified] S1-12 (`permission.asked`) | [Verified] S1-CC-04 (`PermissionRequest`; TUI only on 2.1.181) | [Verified] S1-3H-06 (docs; runtime capture [Blocked]) | TBD |
| Resolution signal | Is approve/deny resolution observable? | [Verified] S1-12 (`permission.replied`; `once`/`reject`) | [Rejected] S1-CC-05 (no event; only inferred) | [Rejected] S1-3H-06 (no decision hook) | TBD |
| Blocking input | Is a blocking question distinguishable from plain text? | [Verified] S1-12/S1-18 (typed permission vs `type:"user"`; question tool not exercised) | [Verified] S1-CC-01/03 (`AskUserQuestion` via `PreToolUse`; docs-only) | [Rejected] S1-3H-06 (permission prompts typed; no arbitrary-question hook) | TBD |
| Turn boundary | Is there a documented stop/idle/turn-end signal? | [Verified] S1-14/16 (`session.execution.*`; documented `session.idle` absent) | [Verified] S1-CC-03 (`Stop`) | [Verified] S1-3H-03 (`Stop`) | TBD |
| Completion | Is verified task or session completion exposed? | [Verified] S1-15/16 (`succeeded` + idle outcome) | [Verified] S1-CC-03 (`Stop`; turn/session only, not semantic success) | [Rejected] S1-3H-03 (boundaries only) | TBD |
| Failure | Is failure/error distinguishable from cancel? | [Verified] S1-17 (`failed` + structured error; `interrupted` reason) | [Verified] S1-CC-06 (`StopFailure`, `PostToolUseFailure`) | [Rejected] S1-3H-06 (`Interrupt` only; no failure hook) | TBD |
| Stable IDs / sequence | Are session and event IDs stable? Is ordering available? | [Verified] S1-20 (`evt_` unique, `durable.seq`; backfill via session log) | [Verified] S1-CC-10 (`session_id`, `prompt_id`, `tool_use_id`; no sequence) | [Verified] S1-3H-03/04 (`session_id`, `turn_id`, `agent_id`; no sequence) | TBD |
| Subagents | Are subagent sessions identifiable? | [Verified] S1-19 (`parentID`, child terminal event) | [Verified] S1-CC-10 (`agent_id`/`agent_type`; docs-only) | [Verified] S1-3H-04 (`SubagentStart/Stop`) | TBD |
| Non-blocking | Can the integration run without delaying the host? | [Verified] S1-09/S1-21 (async subscription; buffer required) | [Verified] S1-CC-08 (sync by default; `async: true` documented) | [Verified] S1-3H-08 (sync by default; `async: true` documented) | TBD |
| Windows-native | Does it run natively on Windows? | [Verified] S1-10/S1-12 | [Verified] S1-CC-11 | [Verified] S1-3H-09 | TBD |
| Stability | Is the API documented and versioned? | [Verified] S1-11 (experimental; runtime names drift) | [Verified] S1-CC-12 (version gates in prose; observed drift) | [Verified] S1-3H-01/02 (`hooks` stable in 0.155.1) | TBD |

Gemini CLI was not evaluated; Codex was chosen as the third host because it
exposed a stronger permission hook. Its column remains `TBD` by design and does
not affect the scorecard.

Evidence records, including negative tests (RF-S1), are appended to
[`spikes/s1-results.md`](./spikes/s1-results.md).

## Scorecard (Task 0.5)

Selection rule (PRD §16.1): highest count of authoritative signals among
{approval, resolution, turn boundary, completion, failure}; integration
convenience breaks ties. Task 0.4 evaluates Codex or Gemini CLI as the third
host; only evaluated hosts receive a score.

| Host | Authoritative count | Tie-breaker notes | Selected |
|---|---|---|---|
| OpenCode | 5/5 | Runtime `permission.asked` / `permission.replied`, `session.execution.*`, idle outcome, structured error, durable sequence, in-process plugin. Documented `session.idle` is absent; use the observed terminal events. | **Yes** |
| Claude Code | 4/5 | Approval, turn boundary, completion, failure. Resolution rejected; approval is interactive-TUI-only on 2.1.181 (headless `-p` gap). Hook process blocks by default; in-process alternative absent. | No |
| Codex CLI | 2/5 | Approval (docs; runtime blocked) and turn boundary. No resolution, completion, or failure signal. | No |

**D-01: OpenCode** wins on 5/5 authoritative signals, one more than Claude
Code. The tie-breaker is not needed, but OpenCode also has the better
integration surface: an in-process plugin and a non-blocking event stream. The
adapter must bind turn end to `session.execution.succeeded|failed|interrupted`,
not the documented-but-absent `session.idle`, and must map `permission.replied`
despite its absence from the V2 documentation.

## Measured vs declared (Phase 3 Tasks 3.8 / 5.4)

| Event | Declared support | Measured behavior | Evidence | Host/date |
|---|---|---|---|---|
| `agent.started` | authoritative | `session.execution.started` normalized with stable session identity | live plain-text capture + fixture replay | OpenCode v2.0.32 / 2026-10-21 |
| `agent.progress` | authoritative | `session.step.started` produces coarse progress; payload fields are dropped | fixture replay, 21 adapter tests | OpenCode v2.0.32 / 2026-10-21 |
| `agent.needs_input` | unsupported | No verified authoritative question signal; no event emitted | capability test and negative fixtures | OpenCode v2.0.32 / 2026-10-21 |
| `agent.needs_approval` | authoritative | `permission.asked` produces a request ID without command/tool payloads | frozen real-host approval fixture + redaction tests | OpenCode v2.0.32 / 2026-10-21 |
| `agent.approval_resolved` | authoritative | `permission.replied` maps `once` to approved and `reject` to denied | frozen real-host approval fixtures | OpenCode v2.0.32 / 2026-10-21 |
| `agent.resumed` | unsupported | No verified resume signal | capability declaration | OpenCode v2.0.32 / 2026-10-21 |
| `agent.turn_ended` | inferred | `session.execution.interrupted` maps to a non-success turn end | live abort capture + fixture replay | OpenCode v2.0.32 / 2026-10-21 |
| `agent.completed` | authoritative | `session.execution.succeeded` maps to session completion | live plain-text capture + fixture replay | OpenCode v2.0.32 / 2026-10-21 |
| `agent.failed` | authoritative | `session.execution.failed` maps to `host_error` | frozen real-host failure fixture | OpenCode v2.0.32 / 2026-10-21 |
| `agent.session_ended` | unsupported | No verified session-end signal | capability declaration | OpenCode v2.0.32 / 2026-10-21 |
| `agent.state_unknown` | unsupported | No host signal; core remains responsible for unknown state | capability declaration | OpenCode v2.0.32 / 2026-10-21 |

The live plain-text scenario completed with `session.execution.succeeded`; the
live abort scenario completed with `session.execution.interrupted`. A fresh
permission-allow attempt did not produce a permission request because that
specific model turn did not invoke a permissioned tool; approval support is
therefore evidenced by the frozen real-host approval capture and its replay
tests, not falsely claimed as a fresh live approval observation.
