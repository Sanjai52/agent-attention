# Host Signal Matrix (S1)

Status: scaffold created by Task 0.1. OpenCode documentation evidence added by
Task 0.2 Step 1; runtime captures, the negative test, and the other host columns
remain open. Scored in Task 0.5.

Every cell starts as `TBD`. A cell clears `TBD` with `[Verified]` evidence: an
official documentation URL with access date, or a capture file under
`spikes/s1-host-signals/out/` with a line reference. Documentation-only evidence
is valid; for example, `Stability` can only be established from docs. Community
examples or undocumented claims are `[Assumption]` and do not score.

## §16.1 criteria

| Criterion | Question | OpenCode | Claude Code | Codex | Gemini CLI |
|---|---|---|---|---|---|
| Approval signal | Is there an authoritative, documented permission-request signal? | [Verified] S1-01 | TBD | TBD | TBD |
| Resolution signal | Is approve/deny resolution observable? | [Assumption] S1-02 (V1 name; V2 unconfirmed) | TBD | TBD | TBD |
| Blocking input | Is a blocking question distinguishable from plain text? | [Verified] S1-03 | TBD | TBD | TBD |
| Turn boundary | Is there a documented stop/idle/turn-end signal? | [Verified] S1-04 | TBD | TBD | TBD |
| Completion | Is verified task or session completion exposed? | [Verified] S1-05 | TBD | TBD | TBD |
| Failure | Is failure/error distinguishable from cancel? | [Verified] S1-06 | TBD | TBD | TBD |
| Stable IDs / sequence | Are session and event IDs stable? Is ordering available? | [Verified] S1-07 | TBD | TBD | TBD |
| Subagents | Are subagent sessions identifiable? | [Verified] S1-08 | TBD | TBD | TBD |
| Non-blocking | Can the integration run without delaying the host? | [Verified] S1-09 (buffer required) | TBD | TBD | TBD |
| Windows-native | Does it run natively on Windows? | [Verified] S1-10 | TBD | TBD | TBD |
| Stability | Is the API documented and versioned? | [Verified] S1-11 (experimental) | TBD | TBD | TBD |

Evidence records, including negative tests (RF-S1), are appended to
[`spikes/s1-results.md`](./spikes/s1-results.md).

## Scorecard (Task 0.5)

Selection rule (PRD §16.1): highest count of authoritative signals among
{approval, resolution, turn boundary, completion, failure}; integration
convenience breaks ties. Task 0.4 evaluates Codex or Gemini CLI as the third
host; only evaluated hosts receive a score.

| Host | Authoritative count | Tie-breaker notes | Selected |
|---|---|---|---|
| OpenCode | TBD | | |
| Claude Code | TBD | | |
| Codex / Gemini CLI | TBD | | |

**D-01:** TBD

## Measured vs declared (Phase 3 Tasks 3.8 / 5.4)

[Per-adapter table: event type -> declared support -> measured behavior -> date/host version]
