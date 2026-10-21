# Expected normalized events — OpenCode fixtures

These are the target mappings for the first adapter. They use the PRD §12.1
event names. `agent.progress` is high-volume and may be coalesced; it is listed
only where the fixture exists to prove ordinary progress is not an approval.

The fixture files are sanitized raw streams, not normalized events. A normalizer
must ignore the `probe:*` records and replay the inner `event` objects in file
order.

## `permission-allow.jsonl`

1. `agent.started` — session `ses_…`
2. `agent.progress` (optional/coalesced) — reasoning/tool progress
3. `agent.needs_approval` — request `per_…`, action `shell`, resource
   `echo probe`, `confidence: authoritative`
4. `agent.approval_resolved` — same `requestId`, `resolution: "approved"`,
   `confidence: authoritative` (from `permission.replied.reply:"once"`)
5. `agent.completed` — `completionScope: "session"`,
   `confidence: authoritative` (from `session.execution.succeeded`; bind the
   idle message `outcome:"succeeded"` before emitting)

No `agent.turn_ended` for the same turn: the execution success is the
authoritative terminal signal, and F10-R4 avoids double-emitting.

## `permission-deny.jsonl`

1. `agent.started`
2. `agent.needs_approval` — request `per_…`
3. `agent.approval_resolved` — same `requestId`, `resolution: "denied"`,
   `confidence: authoritative` (from `permission.replied.reply:"reject"`)
4. `agent.turn_ended` — inferred, no success or failure claim, because
   `session.execution.interrupted` has `reason:"shutdown"` and there is no idle
   message or session outcome

A denial is not `agent.failed` and must not produce a completion alert.

## `plain-text.jsonl`

1. `agent.started`
2. `agent.progress` (optional/coalesced)
3. `agent.completed` — `completionScope: "session"`, from
   `session.execution.succeeded` + idle `outcome:"succeeded"`

The final assistant text is not part of the event contract; only the lifecycle
signal is normalized.

## `negative-progress.jsonl` (RF-S1)

1. `agent.started`
2. `agent.progress` (optional/coalesced)
3. `agent.completed`

Assertions: **zero** `agent.needs_approval`, **zero** `agent.needs_input`, and
no non-empty `permission.pending.snapshot` in the whole fixture.

## `abort.jsonl`

1. `agent.started`
2. `agent.progress` (optional/coalesced)
3. `agent.turn_ended` — inferred; `session.execution.interrupted` with
   `reason:"user"` and idle `outcome:"interrupted"`

No `agent.failed`; a user abort is cancellation, not verified failure.

## `error-invalid-model.jsonl`

1. `agent.started`
2. `agent.failed` — `failureCode: "host_error"`, from
   `session.execution.failed` with `Session.StructuredError`
   (`provider.invalid-request`, status 400)

The idle message repeats `outcome:"failed"`; do not emit a second terminal event.

## `subagent.jsonl`

1. Parent `agent.started`
2. Parent `agent.progress` (optional/coalesced)
3. Child `agent.started` — `isSubagent: true`, `parentSessionId` from
   `session.created.parentID`
4. Child `agent.completed` — `completionScope: "session"`
5. Parent `agent.completed` — `completionScope: "session"`

Subagent completion must not change parent state unless `subagents.notify` is
enabled (D-14). The parent and child have separate session IDs; the child
terminal event does not carry `parentID`, so build the mapping from
`session.created` or `session.get()`.

## Host drift assertions

Every fixture must be replayed with these assertions:

- `session.idle` is absent; a normalizer that waits for it will hang.
- `permission.replied` is present for allow and deny, even though V2 docs omit
  it.
- `session.error` is absent; failure comes from `session.execution.failed`.
- Event `id` values are unique; `durable.seq` is monotonic per session.
- The stream is live-only; a reconnecting adapter must backfill with
  `session.log?after=<seq>&follow=true`.
