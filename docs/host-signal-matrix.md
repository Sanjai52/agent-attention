# Host Signal Matrix (S1)

Status: scaffold created by Task 0.1. Host columns are filled by Tasks 0.2–0.4
and scored in Task 0.5.

Every cell starts as `TBD`. A cell clears `TBD` with `[Verified]` evidence: an
official documentation URL with access date, or a capture file under
`spikes/s1-host-signals/out/` with a line reference. Documentation-only evidence
is valid; for example, `Stability` can only be established from docs. Community
examples or undocumented claims are `[Assumption]` and do not score.

## §16.1 criteria

| Criterion | Question | OpenCode | Claude Code | Codex | Gemini CLI |
|---|---|---|---|---|---|
| Approval signal | Is there an authoritative, documented permission-request signal? | TBD | TBD | TBD | TBD |
| Resolution signal | Is approve/deny resolution observable? | TBD | TBD | TBD | TBD |
| Blocking input | Is a blocking question distinguishable from plain text? | TBD | TBD | TBD | TBD |
| Turn boundary | Is there a documented stop/idle/turn-end signal? | TBD | TBD | TBD | TBD |
| Completion | Is verified task or session completion exposed? | TBD | TBD | TBD | TBD |
| Failure | Is failure/error distinguishable from cancel? | TBD | TBD | TBD | TBD |
| Stable IDs / sequence | Are session and event IDs stable? Is ordering available? | TBD | TBD | TBD | TBD |
| Subagents | Are subagent sessions identifiable? | TBD | TBD | TBD | TBD |
| Non-blocking | Can the integration run without delaying the host? | TBD | TBD | TBD | TBD |
| Windows-native | Does it run natively on Windows? | TBD | TBD | TBD | TBD |
| Stability | Is the API documented and versioned? | TBD | TBD | TBD | TBD |

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
