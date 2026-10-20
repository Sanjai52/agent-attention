# S1 — Host Signal Results

Status: Task 0.2 Step 1 documentation evidence added. Runtime captures, the RF-S1
negative test, and Task 0.5 scoring remain pending.

Scope: per-host verification of the PRD §16.1 criteria for OpenCode, Claude Code,
Codex, and Gemini CLI, and the evidence behind D-01.

- Matrix: [`../host-signal-matrix.md`](../host-signal-matrix.md)
- Spike workspace: [`../../spikes/s1-host-signals/README.md`](../../spikes/s1-host-signals/README.md)
- Raw captures: `spikes/s1-host-signals/out/<host>/*.jsonl` (gitignored)
- Official docs: URL, access date, and section are recorded in each doc-only record

## Evidence record format

Every experiment uses this record, including negative tests:

```markdown
## <experiment id> — <question>
- Date / Windows build / tool versions:
- Method (exact command or script path):
- Raw observation (verbatim output excerpt):
- Conclusion:
- Tag: [Verified] | [Assumption] | [Rejected]
```

## Recording rules

- **ID:** `S1-01`, `S1-02`, … sequential in the order recorded; never renumber.
- **Date / versions:** `YYYY-MM-DD`; the Windows build reported by `winver` or
  `[System.Environment]::OSVersion.Version`; host CLI version; Node version if a
  probe used it. For a doc-only record, give the access date and write
  `n/a (doc-only)` for the Windows build and tool versions.
- **Method:** for a capture, the exact command line or script path, with
  arguments and working directory, enough to rerun the experiment. For a
  doc-only record, the official documentation URL and the section heading relied
  on. A README link alone is not enough.
- **Raw observation:** a verbatim excerpt, not a paraphrase. For a capture, quote
  the output and cite the capture path and line range
  (`out/opencode/permission.jsonl:12-18`); captures are gitignored, so the
  excerpt is the durable evidence. For a doc-only record, quote the relied-on
  documentation text verbatim and name its section. Redact tokens, usernames,
  and credentials.
- **Conclusion:** answer the question and state any limit on the conclusion.
  For a runtime signal, record the RF-S1 negative test that shows ordinary
  progress does not fire it. Documentation-based criteria such as `Stability`
  are concluded from the quoted section.
- **Tag:** exactly one of:
  - `[Verified]` — supported by an official documentation URL with access date,
    or reproduced locally on the recorded Windows build and host version with a
    capture path and line reference. Documentation-only evidence is valid; for
    example, `Stability` can only be established from docs. Only this tag may
    clear `TBD` from a matrix cell.
  - `[Assumption]` — community examples or undocumented claims. Cannot clear a
    matrix cell.
  - `[Rejected]` — tested and failed, or contradicted by measurement. Keep the
    record; do not delete a rejected route.

## Required evidence checklist

| Task | Area | Required evidence | Status |
|---|---|---|---|
| 0.2 | OpenCode | Official docs (URLs + access dates); approved and denied permission captures; plain-text turn end; error/abort; negative test; matrix column | Partial — docs S1-01..S1-11 recorded; captures and negative test pending |
| 0.3 | Claude Code | Hook docs and payload fields; the same three sessions plus a session-end hook if one exists; cold/warm hook runtime and whether the host waits; negative test; matrix column | Pending |
| 0.4 | Third host (Codex or Gemini CLI) | Documented mechanism, or documented `unsupported` with evidence; permission and turn-end captures where available; negative test; matrix column | Pending |
| 0.5 | Scorecard / D-01 | Authoritative count for {approval, resolution, turn boundary, completion, failure}; tie-breaker; winner; fixture paths | Pending |

## Documentation set

Access date for every URL below: **2026-10-20**. Host version context:
`opencode v2.0.32` (`opencode --version`, installed on Windows
10.0.26300.9711). No probe was run for Step 1.

| Ref | Official URL | Docs version |
|---|---|---|
| V2-INTRO | <https://opencode.ai/v2/docs/> | OpenCode V2 (current) |
| V2-PLUGINS | <https://opencode.ai/v2/docs/build/plugins/> | OpenCode V2 (current) |
| V2-CLI-PLUGINS | <https://opencode.ai/v2/docs/build/plugins/cli/> | OpenCode V2 (current) |
| V2-MIGRATE-V1 | <https://opencode.ai/v2/docs/build/plugins/migrate-v1/> | OpenCode V2 (current) |
| V2-PERMISSIONS | <https://opencode.ai/v2/docs/permissions/> | OpenCode V2 (current) |
| V2-AGENTS | <https://opencode.ai/v2/docs/agents/> | OpenCode V2 (current) |
| V2-CLIENT | <https://opencode.ai/v2/docs/build/client/> | OpenCode V2 (current) |
| V2-API | <https://opencode.ai/v2/docs/api/> | OpenAPI 3.1.0, `info.version` 0.0.1 |
| V2-OPENAPI | <https://opencode.ai/v2/openapi.json> | OpenAPI 3.1.0, `info.version` 0.0.1 |
| V1-PLUGINS | <https://opencode.ai/docs/plugins/> | OpenCode 1 (V1) |

The V2 docs do not publish a patch version for the documentation itself. The
installed host is recorded separately so the evidence is not mistaken for a
runtime capture.

## Exact signal and identifier names

| Signal | Exact documented name | Where documented | V2 status |
|---|---|---|---|
| Permission request | `permission.asked` | V2 CLI plugins, `Events`; V1 plugins, `Events > Permission Events` | Confirmed by V2 example |
| Permission resolution | `permission.replied` | V1 plugins, `Events > Permission Events` | Not re-listed in V2 docs; V2 API documents the reply write path `session.permission.reply` |
| Session idle | `session.idle` | V2 migration, `Migrate events and cleanup`; V1 plugins, `Events > Session Events` | Confirmed by V2 example |
| Session execution success | `session.execution.succeeded` | V2 CLI plugins, `Context` cleanup example | Confirmed by V2 example; payload not documented |
| Session error | `session.error` | V1 plugins, `Events > Session Events` | Not named as an event in V2 docs; V2 exposes `Session.Message.Idle.outcome` `failed`/`interrupted` plus `error` |
| Session ID | `Session.ID`, pattern `^ses` | V2 API, `Schemas > Session.ID` | Confirmed |
| Message ID | `Session.Message.ID`, pattern `^msg_` | V2 API, `Schemas > Session.Message.ID` | Confirmed |
| Permission ID | `Permission.ID`, pattern `^per` | V2 API, `Schemas > Permission.ID` | Confirmed |
| SSE event envelope | `id` (string or null), `event` (string), `data` (`V2EventEncoded`) | V2 API, `event.subscribe` | Confirmed |
| Durable session cursor | `after` (`Event.SeqEncoded`), `follow=true` | V2 API, `session.log` | Confirmed |

## Records

API schema observations quote field lines from the official OpenAPI JSON;
surrounding JSON formatting is compacted for readability. Inline code is shown
with normalized spacing where the rendered docs insert spacing around tokens;
prose and identifiers are quoted as published.

## S1-01 — Is there an authoritative permission-request signal?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs current.
- Method: <https://opencode.ai/v2/docs/build/plugins/cli/#events>, section
  `Events`; <https://opencode.ai/v2/docs/permissions/#rules>, section `Rules`;
  <https://opencode.ai/v2/docs/permissions/#approvals>, section `Approvals`.
- Raw observation (verbatim excerpt):
  > Use `data.on` for one typed event or `data.listen` for every server event;
  > both return an unsubscribe function.
  >
  > ```ts
  > context.data.on("permission.asked", (event) => {
  >   context.ui.toast.show({ message: `Permission ${event.data.id}` })
  > })
  > ```
  >
  > `ask` | Wait for a decision from the client
- Conclusion: `permission.asked` is an authoritative, documented permission
  request event, and `event.data.id` carries the permission ID. `ask` explicitly
  means the host waits for a client decision. Limit: the quoted example is the
  CLI plugin surface; the server plugin shares the public event stream, but
  runtime delivery still needs the Step 3 capture.
- Tag: [Verified]

## S1-02 — Is approve/deny resolution observable?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V1 docs and V2 docs current.
- Method: <https://opencode.ai/docs/plugins/#events>, section `Events >
  Permission Events`; <https://opencode.ai/v2/docs/permissions/#approvals>,
  section `Approvals`; <https://opencode.ai/v2/docs/api/#session.permission.reply>,
  operation `session.permission.reply`; <https://opencode.ai/v2/docs/api/#schema-Permission.Reply>,
  schema `Permission.Reply`.
- Raw observation (verbatim excerpt):
  > Permission Events
  >
  > `permission.asked`
  > `permission.replied`
  >
  > When a rule resolves to `ask`, clients can reply with:
  >
  > Allow once | `once` | Approve only the pending request
  > Allow always | `always` | Approve it and save the tool’s proposed patterns for the project
  > Reject | `reject` | Reject it and every other pending permission request in that session
  >
  > Respond to a pending permission request owned by a session.
- Conclusion: V1 docs name `permission.replied`, and V2 docs document the
  approve/deny write path, including the `once` / `always` / `reject` values.
  V2 docs do **not** re-list `permission.replied` or document a resolution event
  that another client can observe. Limit: resolution performed in the TUI by a
  different client is therefore unconfirmed for v2.0.32; a Step 3 capture must
  test it. This record is an assumption for the installed host, not a verified
  V2 signal.
- Tag: [Assumption]

## S1-03 — Is a blocking question distinguishable from plain text?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs current.
- Method: <https://opencode.ai/v2/docs/permissions/#rules>, section `Rules`;
  <https://opencode.ai/v2/docs/permissions/#approvals>, section `Approvals`;
  <https://opencode.ai/v2/docs/api/#schema-Permission.Request>, schema
  `Permission.Request`; <https://opencode.ai/v2/docs/api/#schema-Session.Message.User>,
  schema `Session.Message.User`; <https://opencode.ai/v2/docs/build/plugins/cli/#events>,
  section `Events`.
- Raw observation (verbatim excerpt):
  > `ask` | Wait for a decision from the client
  >
  > `Permission.Request` required fields: `id`, `sessionID`, `action`,
  > `resources`; optional: `save`, `metadata`, `source`, `message`
  >
  > `Session.Message.User` required fields: `id`, `time`, `text`, `type`; its
  > `type` enum is `"user"`.
  >
  > `context.data.on("permission.asked", (event) => { ... event.data.id ... })`
- Conclusion: permission prompts are typed `Permission.Request` objects with a
  permission ID and action/resources, while ordinary user text is a
  `Session.Message.User` with `type: "user"`. The two are structurally
  distinguishable. Limit: the schema distinction is documented; runtime capture
  of both in the same session is still pending.
- Tag: [Verified]

## S1-04 — Is there a documented stop/idle/turn-end signal?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs current.
- Method: <https://opencode.ai/v2/docs/build/plugins/migrate-v1/#migrate-events-and-cleanup>,
  section `Migrate events and cleanup`;
  <https://opencode.ai/v2/docs/api/#experimental.session.wait>, operation
  `experimental.session.wait`.
- Raw observation (verbatim excerpt):
  > V1's event callback becomes an async subscription to the public server event
  > stream. Abort it from the cleanup function returned by setup.
  >
  > `if (event.type === "session.idle") console.log("Session completed")`
  >
  > Wait for a session agent loop to become idle.
- Conclusion: `session.idle` is the documented V2 idle/turn-end event name, and
  `experimental.session.wait` provides a blocking wait for the same idle state.
  Limit: `session.idle` is session-level; the docs do not define a separate
  per-message turn boundary. The Step 3 plain-text session capture is pending.
- Tag: [Verified]

## S1-05 — Is verified task or session completion exposed?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs current.
- Method: <https://opencode.ai/v2/docs/api/#schema-Session.Message.Idle>, schema
  `Session.Message.Idle`; <https://opencode.ai/v2/docs/api/#experimental.session.wait>,
  operation `experimental.session.wait`; <https://opencode.ai/v2/docs/build/plugins/cli/#context>,
  section `Context`.
- Raw observation (verbatim excerpt):
  > `type`: enum `["idle"]`
  >
  > `outcome`: enum `["succeeded", "failed", "interrupted"]`
  >
  > `error`: `Session.StructuredError`
  >
  > Wait for a session agent loop to become idle.
  >
  > `const stop = context.data.on("session.execution.succeeded", () => {})`
  > `return () => stop()`
- Conclusion: V2 docs name `session.execution.succeeded` as an event and the
  session `idle` message exposes a completion outcome, including `succeeded`.
  This is session-level completion, not semantic verification that a user task
  succeeded. Limit: the `session.execution.succeeded` payload and the
  `session.idle` payload binding are not documented; the Step 3 capture must
  bind the event to the idle message.
- Tag: [Verified]

## S1-06 — Is failure/error distinguishable from cancel?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs and V1 docs current.
- Method: <https://opencode.ai/v2/docs/api/#schema-Session.Message.Idle>, schema
  `Session.Message.Idle`; <https://opencode.ai/v2/docs/api/#schema-Session.StructuredError>,
  schema `Session.StructuredError`; <https://opencode.ai/docs/plugins/#events>,
  section `Events > Session Events`.
- Raw observation (verbatim excerpt):
  > `outcome`: enum `["succeeded", "failed", "interrupted"]`
  >
  > `error` properties: `type`, `message`, optional `status` and `response.body`
  >
  > Session Events
  >
  > `session.created` `session.compacted` `session.deleted` `session.diff`
  > `session.error` `session.idle` `session.status` `session.updated`
- Conclusion: the idle outcome distinguishes `failed` from `interrupted`
  (cancel), and `failed` can carry a structured `error`. V1 docs also name a
  `session.error` event; V2 docs do not name a separate `session.error` event.
  Limit: the V2 event payload binding and the RF-S1 negative test are pending.
- Tag: [Verified]

## S1-07 — Are session and event IDs stable? Is ordering available?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs current.
- Method: <https://opencode.ai/v2/docs/api/#schema-Session.ID>, schema
  `Session.ID`; <https://opencode.ai/v2/docs/api/#schema-Session.Message.ID>,
  schema `Session.Message.ID`; <https://opencode.ai/v2/docs/api/#schema-Permission.ID>,
  schema `Permission.ID`; <https://opencode.ai/v2/docs/api/#session.log>,
  operation `session.log`; <https://opencode.ai/v2/docs/api/#event.subscribe>,
  operation `event.subscribe`.
- Raw observation (verbatim excerpt):
  > `Session.ID` pattern: `^ses`
  >
  > `Session.Message.ID` pattern: `^msg_`
  >
  > `Permission.ID` pattern: `^per`
  >
  > Experimental durable session event log. Reads events after an exclusive
  > aggregate sequence and continues with live events when `follow=true`.
  >
  > Volatile by contract: a slow consumer overflows and fails the stream, and
  > events during disconnection are missed.
  >
  > SSE schema: `id` (string or null), `event` (string), `data` (`V2EventEncoded`)
- Conclusion: session, message, and permission IDs are stable documented
  identifiers. A durable ordered cursor is available through the experimental
  session log (`after` + `follow=true`). The general event stream is live-only,
  its SSE `id` may be null, and disconnected events are lost. Limit: no V2
  runtime capture yet; ordering must be validated in Step 3.
- Tag: [Verified]

## S1-08 — Are subagent sessions identifiable?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs current.
- Method: <https://opencode.ai/v2/docs/agents/#modes>, section `Modes`;
  <https://opencode.ai/v2/docs/api/#schema-Session.Info>, schema `Session.Info`;
  <https://opencode.ai/v2/docs/api/#schema-Agent.Info>, schema `Agent.Info`;
  <https://opencode.ai/v2/docs/build/plugins/cli/#sessions>, section `Sessions`.
- Raw observation (verbatim excerpt):
  > Subagents run with fresh context in foreground or background child sessions.
  >
  > `Session.Info` includes `parentID` (`Session.ID`).
  >
  > `Agent.Info.mode` enum: `subagent`, `primary`, `all`.
  >
  > `context.data.session.root(sessionID)`
  > `context.data.session.family(sessionID)`
- Conclusion: subagent child sessions are identifiable through `parentID` and
  `Agent.Info.mode: "subagent"`, with root/family helpers in the CLI data layer.
  Limit: the public event payload may not carry the parent ID directly; querying
  session info may be required. The Step 3 subagent capture is pending.
- Tag: [Verified]

## S1-09 — Can the integration run without delaying the host?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs current.
- Method: <https://opencode.ai/v2/docs/build/plugins/migrate-v1/#migrate-events-and-cleanup>,
  section `Migrate events and cleanup`;
  <https://opencode.ai/v2/docs/build/client/#stream-events>, section
  `Stream events`.
- Raw observation (verbatim excerpt):
  > ```ts
  > void (async () => {
  >   for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
  >     if (event.type === "session.idle") console.log("Session completed")
  >   }
  > })()
  > return () => controller.abort()
  > ```
  >
  > Native and RPC event subscribers share one lazy connection per client.
  > Client, handle, and iterable creation open no event connection; consumption
  > starts it.
  >
  > The shared source waits for active subscribers to accept each event;
  > consumers should buffer before performing slow work.
  >
  > Subscriptions are live-only, with no replay or automatic reconnection.
- Conclusion: the documented pattern starts an async subscription with `void`
  and returns cleanup, so plugin setup does not wait for event consumption. A
  consumer must buffer before slow work; a slow subscriber can backpressure the
  shared event source. Non-blocking is therefore possible but conditional.
  Limit: no latency measurement; the Step 3 capture must confirm the host is not
  delayed in practice.
- Tag: [Verified]

## S1-10 — Does it run natively on Windows?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs current. Version check:
  `opencode --version` -> `opencode v2.0.32`; Windows 10.0.26300.9711.
- Method: <https://opencode.ai/v2/docs/#cli>, section `CLI`; desktop section on
  the same page.
- Raw observation (verbatim excerpt):
  > Download a standalone CLI binary for your platform.
  >
  > Windows: ARM64 · x64 · x64 (baseline)
  >
  > Windows package managers are not supported.
  >
  > Desktop
  > Download the latest OpenCode Desktop build for your platform.
  > ...
  > Windows: x64 · ARM64
- Conclusion: OpenCode documents native Windows CLI binaries (x64 and ARM64) and
  native Windows desktop builds. Package managers are explicitly unsupported.
  The installed v2.0.32 CLI runs on this Windows host. Limit: this is a docs and
  version check, not a runtime probe.
- Tag: [Verified]

## S1-11 — Is the API documented and versioned?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / OpenCode
  v2.0.32 host; V2 docs current.
- Method: <https://opencode.ai/v2/docs/api/>, header `HTTP API`;
  <https://opencode.ai/v2/docs/api/#event.subscribe>, operation
  `event.subscribe`; <https://opencode.ai/v2/openapi.json>, root `info`;
  <https://opencode.ai/v2/docs/build/plugins/#publish>, section `Publish`.
- Raw observation (verbatim excerpt):
  > OpenAPI 3.1.0
  >
  > Experimental HttpApi surface for selected instance routes.
  >
  > `"version": "0.0.1"`
  >
  > Volatile by contract: a slow consumer overflows and fails the stream, and
  > events during disconnection are missed.
  >
  > Use versions compatible with the OpenCode release you target and test the
  > installed package, not only a workspace-linked copy.
- Conclusion: the API is documented and major-versioned under V2, with an
  OpenAPI 3.1.0 specification (`info.version` 0.0.1). It is explicitly labeled
  experimental, and the event stream is volatile by contract, so there is no
  stable semver API guarantee. Limit: the docs do not promise backward
  compatibility across V2 patch releases.
- Tag: [Verified]
