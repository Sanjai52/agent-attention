# OpenCode S1 fixtures

Frozen raw captures from the Task 0.2 runtime probe. These are the replay
fixtures for the first adapter and the evidence behind D-01.

- Host: **OpenCode v2.0.32**
- Date: **2026-10-20**
- OS: Windows 10.0.26300.0 (`[System.Environment]::OSVersion.Version`)
- Node used by the probe: **v24.20.0**
- Source: `spikes/s1-host-signals/opencode/` at commit `4bcf431`
- Original captures: `spikes/s1-host-signals/out/opencode/` (gitignored)

## Files

| File | Scenario | Signals to assert |
|---|---|---|
| `permission-allow.jsonl` | Permission dialog approved with `once` | `permission.asked` (`per_…`), `permission.replied` (`once`), `session.execution.succeeded` |
| `permission-deny.jsonl` | Permission dialog rejected | `permission.asked`, `permission.replied` (`reject`), `session.execution.interrupted` (`reason:"shutdown"`), no idle message |
| `plain-text.jsonl` | Plain-text turn | `session.execution.succeeded`, idle message `outcome:"succeeded"` |
| `negative-progress.jsonl` | Progress only; no tools (RF-S1) | no `permission.asked`; no non-empty pending snapshot; `session.execution.succeeded` |
| `abort.jsonl` | User abort | `session.execution.interrupted` (`reason:"user"`), idle `outcome:"interrupted"` |
| `error-invalid-model.jsonl` | Provider error | `session.execution.failed` with `Session.StructuredError`; idle `outcome:"failed"` |
| `subagent.jsonl` | Parent launches a child session | `session.created.parentID`; child + parent terminal events |

`environment.json` records host/version/date and the sanitization rule.
`expected.md` lists the normalized event sequence each fixture must produce.

## Record shape

Each line is one of:

- `{"kind":"event","event":{…}}` — a host event, logged verbatim from the
  plugin subscription. The inner `event` carries `id`, `created`, `type`,
  `durable` (`aggregateID`, `seq`, `version`), `location`, and `data`.
- `{"kind":"probe:…","…"}` — probe instrumentation, not a host event:
  `plugin.setup`, `event.stream.open`, `hook.session.prompt`,
  `permission.pending.snapshot`, `session.outcome.binding`.

The fixture README and `expected.md` are the authority for what to replay.
Probe records may be ignored by a normalizer; the raw host events are the input.

## Sanitization

- Absolute checkout paths are replaced with `<CHECKOUT>`; home paths with
  `<USER_HOME>`.
- The body of `session.instructions.updated` is replaced with
  `<REDACTED_GLOBAL_INSTRUCTIONS>`; the event envelope and delta hashes remain.
- Model reasoning text is replaced with `<REDACTED_MODEL_REASONING>` in
  `session.reasoning.delta` / `session.reasoning.ended`; event names and counts
  remain.
- The probe-added `lastMessages` array is removed from outcome bindings to
  avoid freezing global instruction text. `idleMessages` and `sessionOutcome`
  are preserved.
- Event names, IDs, payload fields, ordering, and counts are unchanged.

## Host drift to remember

- Documented `session.idle` did **not** fire (0/260 events). The terminal
  signals are `session.execution.succeeded|failed|interrupted`.
- `permission.replied` **did** fire but is absent from the V2 docs.
- `session.error` was not observed; use `session.execution.failed` with
  `Session.StructuredError`.
- The stream is live-only and can miss the first event. Backfill with
  `session.log?after=<seq>&follow=true` or tolerate the gap.

Captures are from one Windows build and one host patch. Re-probe on host
upgrades; do not treat these names as stable across V2 minor versions.
