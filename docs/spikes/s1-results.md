# S1 — Host Signal Results

Status: OpenCode runtime captures and the RF-S1 negative test are complete
(S1-12–S1-21). Claude Code (S1-CC) and Codex CLI (S1-3H) probes are complete,
with the Codex approval runtime capture explicitly blocked. Task 0.5 selects
OpenCode and freezes its fixtures.

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
| 0.2 | OpenCode | Official docs (URLs + access dates); approved and denied permission captures; plain-text turn end; error/abort; negative test; matrix column | Complete — S1-12–S1-21 |
| 0.3 | Claude Code | Hook docs and payload fields; the same three sessions plus a session-end hook if one exists; cold/warm hook runtime and whether the host waits; negative test; matrix column | Complete — S1-CC-01–12; model mocked after OAuth expiry |
| 0.4 | Third host (Codex or Gemini CLI) | Documented mechanism, or documented `unsupported` with evidence; permission and turn-end captures where available; negative test; matrix column | Complete — Codex S1-3H-01–09; approval runtime blocked |
| 0.5 | Scorecard / D-01 | Authoritative count for {approval, resolution, turn boundary, completion, failure}; tie-breaker; winner; fixture paths | Complete — OpenCode 5/5, fixtures under `tests/fixtures/opencode/` |

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
| Permission resolution | `permission.replied` | V1 plugins, `Events > Permission Events`; runtime v2.0.32 | **Confirmed at runtime in v2.0.32** with `{sessionID, requestID, reply}` (`once`, `reject`), despite being absent from V2 docs |
| Session idle | `session.idle` | V2 migration, `Migrate events and cleanup`; V1 plugins, `Events > Session Events` | **Rejected at runtime in v2.0.32**: 0/260 events. Use `session.execution.*` |
| Session execution started | `session.execution.started` | V2 runtime | Observed in v2.0.32; lifecycle only |
| Session execution success | `session.execution.succeeded` | V2 CLI plugins, `Context` cleanup example; runtime v2.0.32 | Confirmed at runtime; `data` carries `{sessionID}`; binds to idle `outcome:"succeeded"` |
| Session execution failure | `session.execution.failed` | V2 runtime | Observed with `Session.StructuredError`; idle `outcome:"failed"` |
| Session execution interruption | `session.execution.interrupted` | V2 runtime | Observed with `data.reason`: `user` (abort) or `shutdown` (permission reject) |
| Session error | `session.error` | V1 plugins, `Events > Session Events` | Not observed in v2.0.32 (0/260); use `session.execution.failed` with `Session.StructuredError` |
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
  V2 docs do **not** re-list `permission.replied`. **S1-12 closes that gap at
  runtime:** v2.0.32 emits `permission.replied` with
  `{sessionID, requestID, reply}` (allow capture `once`, deny capture `reject`).
  It is the authoritative resolution signal; polling is a lossy fallback
  (S1-13).
- Tag: [Verified]

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
  per-message turn boundary. **S1-14 rejected the documented `session.idle`
  event at runtime in v2.0.32 (0/260); use `session.execution.*` instead.**
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
  succeeded. Limit: the `session.execution.succeeded` payload and the idle
  message binding are not documented. **S1-15/S1-16 bind
  `session.execution.succeeded` (`data: {sessionID}`) to a durable idle message
  with `outcome:"succeeded"` at runtime; the binding is a follow-up read.**
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
  **S1-17 confirms at runtime: provider failure is
  `session.execution.failed` with `Session.StructuredError`; user abort is
  `interrupted` + `reason:"user"`; permission rejection is `interrupted` +
  `reason:"shutdown"`, with no idle message or session outcome. No
  `session.error` was observed (0/260). The RF-S1 negative test is S1-18.**
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
## S1-12 — Does `permission.replied` exist at runtime in v2.0.32, and what does it carry?

- Date / Windows build / tool versions: 2026-10-20 / Windows 10.0.26300.0 /
  OpenCode v2.0.32, Node v24.20.0.
- Method: `node spikes/s1-host-signals/opencode/run-capture.mjs permission-allow`
  and `... permission-deny`; event stream logged by
  `spikes/s1-host-signals/opencode/config/probe/index.ts`; replies sent through
  `POST /api/session/{sessionID}/permission/{requestID}/reply`.
- Raw observation (verbatim excerpt; `location` omitted, all other fields
  verbatim):
  - `out/opencode/permission-allow.jsonl:34`:
    ```json
    {
      "id": "evt_158aef633002ndWUwNr8bnpnJ7",
      "created": 1792489223731,
      "type": "permission.asked",
      "durable": { "aggregateID": "ses_ea7511be3ffeh87JIG2o9JrAmm", "seq": 8, "version": 1 },
      "data": {
        "id": "per_158aef633001X1JqabeOKnHqD6",
        "sessionID": "ses_ea7511be3ffeh87JIG2o9JrAmm",
        "action": "shell",
        "resources": ["echo probe"],
        "save": ["echo *"],
        "source": {
          "type": "tool",
          "messageID": "msg_158aeeaa8001Ndm9xAZ1pqnPxC",
          "id": "call_00_ztf6sxOcwiarSfBOc0Rl3611"
        }
      }
    }
    ```
  - `out/opencode/permission-allow.jsonl:36`:
    ```json
    {
      "id": "evt_158aef6e1001rRaZX5qQ6yG1Ou",
      "created": 1792489223906,
      "type": "permission.replied",
      "durable": { "aggregateID": "ses_ea7511be3ffeh87JIG2o9JrAmm", "seq": 10, "version": 1 },
      "data": {
        "sessionID": "ses_ea7511be3ffeh87JIG2o9JrAmm",
        "requestID": "per_158aef633001X1JqabeOKnHqD6",
        "reply": "once"
      }
    }
    ```
  - `out/opencode/permission-deny.jsonl:35`:
    ```json
    {
      "id": "evt_158af1684001wC2gO6fK4HjmRA",
      "created": 1792489232004,
      "type": "permission.replied",
      "durable": { "aggregateID": "ses_ea750fc26ffeFBc5VhUrsb17r9", "seq": 9, "version": 1 },
      "data": {
        "sessionID": "ses_ea750fc26ffeFBc5VhUrsb17r9",
        "requestID": "per_158af166e001SLWxxIvrwc75wg",
        "reply": "reject"
      }
    }
    ```
- Conclusion: `permission.replied` **does exist** in v2.0.32 even though the V2
  docs do not list it. It is the authoritative resolution signal and carries
  `sessionID`, `requestID`, and `reply` (`once` and `reject` observed). The
  reply value distinguishes approval from rejection. Limit: the model-facing
  effect of `reject` is `session.execution.interrupted` with
  `reason:"shutdown"` (S1-17), not a failed outcome.
- Tag: [Verified]

## S1-13 — Can resolution be inferred from polling `permission.asked` / pending requests?

- Date / Windows build / tool versions: as S1-12.
- Method: probe calls documented `ctx.permission.list({ sessionID })` every
  250 ms and logs only changes; compare the snapshot timeline with
  `permission.replied`.
- Raw observation (verbatim excerpt):
  - `out/opencode/permission-allow.jsonl:35`:
    ```json
    {
      "seq": 35,
      "ts": 1792489223837,
      "kind": "permission.pending.snapshot",
      "sessionID": "ses_ea7511be3ffeh87JIG2o9JrAmm",
      "count": 1,
      "requests": [
        {
          "id": "per_158aef633001X1JqabeOKnHqD6",
          "sessionID": "ses_ea7511be3ffeh87JIG2o9JrAmm",
          "action": "shell",
          "resources": ["echo probe"],
          "save": ["echo *"],
          "source": {
            "type": "tool",
            "messageID": "msg_158aeeaa8001Ndm9xAZ1pqnPxC",
            "id": "call_00_ztf6sxOcwiarSfBOc0Rl3611"
          }
        }
      ]
    }
    ```
  - `out/opencode/permission-allow.jsonl:44`: `{"seq":44,…,"count":0,"requests":[]}`
  - `out/opencode/permission-deny.jsonl` contains a `count:0` snapshot at line 20
    and **no** `count:1` snapshot; the request was asked at line 34 and rejected
    at line 35, 22 ms later, inside one 250 ms poll interval.
- Conclusion: polling can observe that a request exists and later that the set is
  empty, so it can infer _that_ a request resolved. It cannot reliably infer
  _how_ it resolved, and it can miss short-lived requests entirely (observed in
  the deny run). Polling is a lossy fallback only; `permission.replied` is the
  authoritative signal. Limit: one poll interval (250 ms) was used; a shorter
  interval narrows but does not close the gap.
- Tag: [Verified]

## S1-14 — Does the documented `session.idle` event fire in v2.0.32?

- Date / Windows build / tool versions: as S1-12.
- Method: all seven captures; the plugin subscribes to the public stream before
  prompting and logs every event. Count `session.idle` occurrences.
- Raw observation (verbatim excerpt):
  - `out/opencode/plain-text.jsonl:35` is the terminal signal for a plain-text
    turn:
    ```json
    {
      "id": "evt_158af5ec2001eG7wPUHHEhJe7C",
      "created": 1792489250498,
      "type": "session.execution.succeeded",
      "durable": { "aggregateID": "ses_ea750e3f2ffeZdcZzGk8S6QKSM", "seq": 10, "version": 1 },
      "data": { "sessionID": "ses_ea750e3f2ffeZdcZzGk8S6QKSM" }
    }
    ```
  - `node spikes/s1-host-signals/opencode/analyze.mjs` prints
    `session.idle=0` across 260 events.
  - The same run produced streaming progress events
    (`session.reasoning.delta`, `session.text.delta`, `session.step.streamed`)
    and then `session.execution.succeeded`.
- Conclusion: **`session.idle` was not emitted in any of the seven sessions.**
  The documented V2 example event name does not match v2.0.32 runtime behavior.
  The runtime terminal event is `session.execution.succeeded`,
  `session.execution.failed`, or `session.execution.interrupted`. Therefore an
  adapter must not bind turn-end to `session.idle` on this version. Limit: a
  session with an internal tool wait might emit it; none of the seven sessions
  did, including a tool call, a rejection, an abort, and a provider error.
- Tag: [Rejected]

## S1-15 — Does the terminal event bind to `Session.Message.Idle.outcome`?

- Date / Windows build / tool versions: as S1-12.
- Method: on `session.execution.*`, the plugin waits 150 ms, then calls
  `ctx.session.context({ sessionID })` and `ctx.session.get({ sessionID })` and
  logs the idle message and session outcome.
- Raw observation (verbatim excerpt):
  - `out/opencode/plain-text.jsonl:36`:
    ```json
    {"seq":36,"ts":1792489250663,"kind":"session.outcome.binding","trigger":"session.execution.succeeded","sessionID":"ses_ea750e3f2ffeZdcZzGk8S6QKSM","idleMessages":[{"id":"msg_158af5ec2001eG7wPUHHEhJe7C","time":{"created":1792489250498},"type":"idle","outcome":"succeeded"}],"sessionOutcome":"succeeded",…}
    ```
  - `out/opencode/abort.jsonl:27`:
    ```json
    {"kind":"session.outcome.binding","trigger":"session.execution.interrupted","sessionID":"ses_ea750873dffeeQCuvi4BCE3QJb","idleMessages":[{"id":"msg_158af85c5001KJ115wcCTnw6K0","time":{"created":1792489260485},"type":"idle","outcome":"interrupted"}],"sessionOutcome":"interrupted",…}
    ```
  - `out/opencode/error-invalid-model.jsonl:27`:
    ```json
    {"kind":"session.outcome.binding","trigger":"session.execution.failed","sessionID":"ses_ea7507524ffeq781lq0dyU3lhL","idleMessages":[{"id":"msg_158af9b39001yqwzBOGZazv6fU","time":{"created":1792489265977},"type":"idle","outcome":"failed","error":{"type":"provider.invalid-request","message":"The requested model is not supported.","status":400,"response":{"body":"{\"error\":{\"message\":\"The requested model is not supported.\",\"code\":\"model_not_supported\",\"param\":\"model\",\"type\":\"invalid_request_error\"}}\n"}}}],"sessionOutcome":"failed",…}
    ```
- Conclusion: the durable idle message exists and its `outcome` exactly matches
  the terminal event: `succeeded` / `failed` / `interrupted`. Its `id` shares the
  event's suffix but uses the `msg_` prefix. This gives the binding needed for
  PRD §16.1 Completion and Failure without relying on `session.idle`. Limit: the
  binding is a follow-up read, not part of the event payload; there is a
  sub-second race if the session is deleted immediately.
- Tag: [Verified]

## S1-16 — Does `session.execution.succeeded` exist, and what does it carry?

- Date / Windows build / tool versions: as S1-12.
- Method: observe the terminal event on plain-text, permission-approved, and
  subagent runs.
- Raw observation (verbatim excerpt):
  - `out/opencode/plain-text.jsonl:35`:
    ```json
    {
      "id": "evt_158af5ec2001eG7wPUHHEhJe7C",
      "created": 1792489250498,
      "type": "session.execution.succeeded",
      "durable": { "aggregateID": "ses_ea750e3f2ffeZdcZzGk8S6QKSM", "seq": 10, "version": 1 },
      "data": { "sessionID": "ses_ea750e3f2ffeZdcZzGk8S6QKSM" }
    }
    ```
  - `out/opencode/permission-allow.jsonl:56`:
    ```json
    {"kind":"session.outcome.binding","trigger":"session.execution.succeeded","sessionID":"ses_ea7511be3ffeh87JIG2o9JrAmm","idleMessages":[{"id":"msg_158aeff01001aYcdOsgoQQE3Qn","time":{"created":1792489225985},"type":"idle","outcome":"succeeded"}],"sessionOutcome":"succeeded",…}
    ```
- Conclusion: `session.execution.succeeded` exists in v2.0.32. Its `data` payload
  carries **only** `sessionID`; the stable event `id`, timestamp, and
  `durable.aggregateID` / `durable.seq` are in the envelope. It is session-level
  execution success, not semantic verification of the user's task. The idle
  message is the only place the outcome is repeated. Limit: no task/step scope
  in the payload.
- Tag: [Verified]

## S1-17 — Are failure, user abort, and permission denial distinguishable?

- Date / Windows build / tool versions: as S1-12.
- Method: three sessions — provider error (invalid model), explicit
  `POST /interrupt`, and permission `reject`.
- Raw observation (verbatim excerpt):
  - `out/opencode/error-invalid-model.jsonl:26`:
    ```json
    {
      "id": "evt_158af9b39001yqwzBOGZazv6fU",
      "created": 1792489265977,
      "type": "session.execution.failed",
      "durable": { "aggregateID": "ses_ea7507524ffeq781lq0dyU3lhL", "seq": 7, "version": 1 },
      "data": {
        "sessionID": "ses_ea7507524ffeq781lq0dyU3lhL",
        "error": {
          "type": "provider.invalid-request",
          "message": "The requested model is not supported.",
          "status": 400,
          "response": {
            "body": "{\"error\":{\"message\":\"The requested model is not supported.\",\"code\":\"model_not_supported\",\"param\":\"model\",\"type\":\"invalid_request_error\"}}\n"
          }
        }
      }
    }
    ```
  - `out/opencode/abort.jsonl:23`:
    ```json
    {
      "id": "evt_158af85c5001KJ115wcCTnw6K0",
      "created": 1792489260485,
      "type": "session.execution.interrupted",
      "durable": { "aggregateID": "ses_ea750873dffeeQCuvi4BCE3QJb", "seq": 7, "version": 1 },
      "data": { "sessionID": "ses_ea750873dffeeQCuvi4BCE3QJb", "reason": "user" }
    }
    ```
  - `out/opencode/permission-deny.jsonl:39`:
    ```json
    {
      "id": "evt_158af16d6001kxsn3tCjsF9cTs",
      "created": 1792489232086,
      "type": "session.execution.interrupted",
      "durable": { "aggregateID": "ses_ea750fc26ffeFBc5VhUrsb17r9", "seq": 14, "version": 1 },
      "data": { "sessionID": "ses_ea750fc26ffeFBc5VhUrsb17r9", "reason": "shutdown" }
    }
    ```
  - `out/opencode/permission-deny.jsonl:40` binding has
    `"idleMessages":[]`, while the abort binding has one idle message with
    `outcome:"interrupted"`.
  - The same binding shows the denied turn is marked as an abort at the message
    level: the last assistant message has `finish:"error"` and
    `error:{"type":"aborted","message":"Step interrupted"}`, and the declined
    tool part has `state.status:"error"` with
    `error:{"type":"aborted","message":"The user declined this tool call"}`.
    `session.get().outcome` is absent for this session.
- Conclusion: yes, with a caveat. `session.execution.failed` carries a
  `Session.StructuredError` and yields an idle message `outcome:"failed"`.
  User abort yields `session.execution.interrupted` with `reason:"user"` and an
  idle message `outcome:"interrupted"`. Permission rejection yields
  `session.execution.interrupted` with `reason:"shutdown"`, **no idle
  message**, no session `outcome`, and an assistant message/tool part marked
  `"aborted"`. A notification adapter must treat `reason:"shutdown"` as a
  cancelled/denied turn, and must not equate `finish:"error"` on the message
  with a provider failure. Limit: no runtime `session.error` event was observed
  (0/260).
- Tag: [Verified]

## S1-18 — RF-S1 negative test: does ordinary progress fire a permission/question signal?

- Date / Windows build / tool versions: as S1-12.
- Method: `node spikes/s1-host-signals/opencode/run-capture.mjs negative-progress`;
  prompt: “Reply with exactly NEGATIVE_PROGRESS_OK and do not use any tools.
  This is an ordinary progress-only turn.” The probe still polls permissions and
  logs all events.
- Raw observation (verbatim excerpt):
  - `out/opencode/negative-progress.jsonl:20`:
    ```json
    {
      "seq": 20,
      "ts": 1792489253505,
      "iso": "2026-10-20T09:40:53.505Z",
      "kind": "permission.pending.snapshot",
      "sessionID": "ses_ea7509bd6ffeXlMUoqN3kXoT9n",
      "count": 0,
      "requests": []
    }
    ```
  - The same capture contains `session.reasoning.delta` (3), `session.text.delta`,
    `session.text.started`, `session.text.ended`, `session.step.streamed`, then
    `session.execution.succeeded` at line 36. It contains **no**
    `permission.asked`, no non-empty pending snapshot, and no question event.
  - `node .../analyze.mjs`: `negative-progress: … pending>0=0`.
- Conclusion: ordinary text/reasoning progress does **not** fire the
  permission signal. The negative test passes. Limit: the prompt forbade tools,
  so it exercises text progress, not a long tool-progress stream; the
  permission-approved capture separately shows `session.tool.progress` for a
  running shell without a second permission request.
- Tag: [Verified]

## S1-19 — Are subagent sessions identifiable at runtime?

- Date / Windows build / tool versions: as S1-12.
- Method: `node spikes/s1-host-signals/opencode/run-capture.mjs subagent`; prompt
  asks the build agent to launch a task subagent that replies `SUBAGENT_OK`.
- Raw observation (verbatim excerpt; `location` omitted):
  - `out/opencode/subagent.jsonl:35` (prompt hook for the child):
    ```json
    {
      "seq": 35,
      "ts": 1792489271918,
      "kind": "hook.session.prompt",
      "event": {
        "sessionID": "ses_ea7504e4cffel0pSDmvUY7B61V",
        "messageID": "msg_158afb26d001MK9IspUwsD8CaZ",
        "prompt": {
          "text": "You are a subagent spawned by another session.\nReply with exactly the following text and nothing else, no preamble, no code fences:\n\nSUBAGENT_OK"
        },
        "delivery": "steer"
      }
    }
    ```
  - `out/opencode/subagent.jsonl:36`:
    ```json
    {"id":"evt_158afb267001JtFKvEITJMjGk5","created":1792489271911,"type":"session.created","durable":{"aggregateID":"ses_ea7504e4cffel0pSDmvUY7B61V","seq":0,"version":1},"data":{"sessionID":"ses_ea7504e4cffel0pSDmvUY7B61V","parentID":"ses_ea7506011ffeuF29DsFyt5R1uW","title":"Reply SUBAGENT_OK","agent":"general","model":{"id":"deepseek-v4.1-flash-free","providerID":"opencode","variant":"default"},"version":"2.0.32",…}}
    ```
  - `out/opencode/subagent.jsonl:57` is the child's
    `session.execution.succeeded`; line 62 binds it with
    `"sessionParentID":"ses_ea7506011ffeuF29DsFyt5R1uW"`; line 76 is the
    parent's `session.execution.succeeded`.
- Conclusion: subagent child sessions are identifiable from
  `session.created.data.parentID`, from `session.get().parentID`, and from the
  prompt hook's `sessionID` (the child's prompt is the synthetic delegation
  text). The child emits its own terminal event and idle message. Limit: the
  terminal event payload does not itself carry `parentID`; a mapping must be
  built from `session.created` or a session read.
- Tag: [Verified]

## S1-20 — Are event IDs and ordering stable at runtime?

- Date / Windows build / tool versions: as S1-12.
- Method: inspect every event envelope across the seven captures; count IDs;
  check `durable.seq` monotonicity per `aggregateID`.
- Raw observation (verbatim excerpt):
  - `out/opencode/permission-allow.jsonl:34` shows
    `"id":"evt_158aef633002ndWUwNr8bnpnJ7"` and
    `"durable":{"aggregateID":"ses_ea7511be3ffeh87JIG2o9JrAmm","seq":8,"version":1}`.
  - `analyze.mjs` output: `total events=260 unique ids=260 duplicate ids=0`;
    every observed aggregate is `monotonic=true`; parent sessions start at
    `seq:1` (the plugin missed the parent `session.created`), the child at
    `seq:0`.
- Conclusion: event IDs are unique and stable for the life of the capture, and
  `durable.seq` gives per-session ordering. The live subscription is not
  replayable: the parent `session.created` (seq 0) was missed because the plugin
  subscribed after session creation. A durable adapter must backfill with
  `GET /api/experimental/session/{sessionID}/log?after=<seq>&follow=true` or
  accept that the first event can be absent. Limit: the documented `event.subscribe`
  SSE `id` is present here, but the docs still call the stream volatile.
- Tag: [Verified]

## S1-21 — What does the documented prompt hook receive, and does plugin setup run as documented?

- Date / Windows build / tool versions: as S1-12.
- Method: `ctx.session.hook("prompt", (event) => log(...))` in the probe; log
  `plugin.setup` with `ctx.app` and `ctx.location`.
- Raw observation (verbatim excerpt):
  - `out/opencode/permission-allow.jsonl:1`:
    ```json
    {
      "seq": 1,
      "ts": 1792489220192,
      "kind": "plugin.setup",
      "app": { "name": "cli", "version": "2.0.32", "channel": "latest" },
      "location": {
        "directory": "…\\sandbox",
        "project": {
          "id": "4e4e4be9e75d452d28210732ddb6ccf16a78a442",
          "directory": "…",
          "canonical": "…"
        }
      },
      "options": {},
      "logPath": "…"
    }
    ```
  - `out/opencode/permission-allow.jsonl:14`:
    ```json
    {
      "seq": 14,
      "ts": 1792489220715,
      "kind": "hook.session.prompt",
      "event": {
        "sessionID": "ses_ea7511be3ffeh87JIG2o9JrAmm",
        "messageID": "msg_158aee649001DL4sPs3XmNND62",
        "prompt": {
          "text": "Use the bash/shell tool to run exactly: echo probe\nThen reply with the tool output and nothing else."
        },
        "delivery": "steer"
      }
    }
    ```
- Conclusion: local plugins load from an absolute directory in `plugins`, setup
  receives `ctx.app.version = "2.0.32"`, and the prompt hook receives
  `sessionID`, `messageID`, mutable `prompt.text`, and `delivery`. This is
  enough to observe user prompt admission, but not to infer turn end. Limit:
  plugin cleanup was not captured because the private servers were terminated
  with `taskkill /T`; the manual smoke server did log `plugin.cleanup`, so the
  lifecycle callback exists.
- Tag: [Verified]

---


## Host extension: Claude Code records (S1-CC)

These records use a host-specific ID prefix so the existing S1-01–S1-21
sequence is not renumbered. Each record has the same six fields and tag rules.
Source: `docs/spikes/phase-0-shards/s1-claude-code.md`.

### S1-CC-01 — Which hook events and payload fields are officially documented, and do they block?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181, Node v24.20.0.
- Method: <https://code.claude.com/docs/en/hooks>, sections `Hook lifecycle`,
  `Configuration`, `Hook input and output`, `JSON output`, and the per-event
  sections listed in the documentation table above.
- Raw observation (verbatim excerpt):
  > Events fall into three cadences:
  > * per session: `SessionStart` and `SessionEnd`
  > * per turn: `UserPromptSubmit`, `Stop`, and `StopFailure`
  > * on every tool call inside the agentic loop: `PreToolUse` and `PostToolUse`
  >
  > `PermissionRequest` | When a tool call needs a permission decision
  >
  > Use this event when you need a signal the moment Claude asks for permission
  > to use a tool. Claude Code runs a `Notification` hook with the
  > `permission_prompt` type only after the prompt has waited about six seconds.
  >
  > `PostToolUse` | After a tool call succeeds
  > `PostToolUseFailure` | After a tool call fails
  > `Stop` | When Claude finishes responding
  > `StopFailure` | When the turn ends due to an API error
  > `SessionEnd` | When a session terminates
  >
  > When your hook's run finishes, Claude Code uses its exit code to decide
  > whether to continue with the action that triggered it
  >
  > `async` | If `true`, runs in the background without blocking.
- Conclusion: Claude Code documents a dedicated `PermissionRequest` event
  distinct from `Notification`, a normal-turn `Stop`, an API-error `StopFailure`,
  tool success/failure events, and `SessionEnd`. Command hooks run
  synchronously and can block the action unless `async: true` is set. Docs are
  current-only, not version-pinned.
- Tag: [Verified]

### S1-CC-02 — Can a throwaway profile register the probes without touching the user's configuration?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181.
- Method: `node spikes/s1-host-signals/claude-code/prepare.cjs` created
  `spikes/s1-host-signals/out/claude-code/config` with `.credentials.json`,
  minimal `.claude.json`, and `settings.json` from `settings.template.json`.
  Every run used `CLAUDE_CONFIG_DIR=<that directory>`. The user's
  `%USERPROFILE%\.claude\settings.json` was only read (to confirm it contains
  this host's hooks); it was never written.
- Raw observation (verbatim excerpt from `out/claude-code/smoke.jsonl:1`):
  > `"event_name":"SessionStart"`, `"env":{"CLAUDE_PROJECT_DIR":"...\\out\\claude-code\\sandbox","CLAUDE_PLUGIN_ROOT":null,"CLAUDE_CONFIG_DIR":"...\\out\\claude-code\\config"}`
  >
  > `claude -p ... "PLAIN"` -> `probe-plain-text` (exit 0)
  >
  > Without `ANTHROPIC_BASE_URL`: `Failed to authenticate. API Error: 401 OAuth access token is invalid.` (exit 1)
- Conclusion: A temp `CLAUDE_CONFIG_DIR` is sufficient to register probe hooks;
  probe processes inherit `CLAUDE_PROJECT_DIR` and `CLAUDE_CONFIG_DIR`. The
  installed account's OAuth access token expired on 2026-06-18 and refresh did
  not recover it, so authenticated model calls are blocked. Subsequent captures
  point `ANTHROPIC_BASE_URL` at a local mock; only the model is mocked.
- Tag: [Verified] (registration and auth diagnostic); the mock is a stated
  limitation, not a substitute for a live-model capture.

### S1-CC-03 — Plain-text turn end: which signals fire, and does ordinary text fire approval/question hooks (RF-S1)?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181, Node v24.20.0.
- Method:
  `CLAUDE_CONFIG_DIR=<temp> ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=sk-ant-api03-probe PROBE_RUN_ID=timing2-baseline claude -p --permission-mode default "PLAIN"`
  from `spikes/s1-host-signals/out/claude-code/sandbox`.
- Raw observation (verbatim excerpt, `out/claude-code/timing2-baseline.jsonl:1-8`):
  > `SessionStart` -> `UserPromptSubmit` -> `Stop` -> `SessionEnd`
  >
  > `Stop` payload: `"stop_hook_active":false,"last_assistant_message":"probe-plain-text","background_tasks":[],"session_crons":[]`
  >
  > No `PermissionRequest`, no `PostToolUse`, no `Notification` line exists in
  > the capture.
- Conclusion: A plain-text turn has a clear turn-boundary signal, `Stop`, with
  the final assistant text inline. Ordinary assistant text does **not** fire
  `PermissionRequest`; the RF-S1 negative test passes for this event. `Stop` is
  session/turn completion, not semantic verification that the user's task
  succeeded.
- Tag: [Verified]

### S1-CC-04 — Approved permission: which event is the request, and what follows approval?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181.
- Method: `python spikes/s1-host-signals/claude-code/drive_interactive.py --prompt TOOL_OK --answer yes --out ../tui-approve.log`
  under a pywinpty pseudo-console, with the temp profile and mock API. The real
  TUI showed `Permission Required: Bash command` and the driver sent `1` +
  Enter (menu item `1. Yes`).
- Raw observation (verbatim excerpt, `out/claude-code/tui-approve.jsonl:15-22`):
  > `PreToolUse` (tool_name `Bash`, tool_use_id `toolu_probe_...`)
  > `PermissionRequest` (tool_name `Bash`, `permission_suggestions[0].behavior = "allow"`, no `tool_use_id`)
  > `PostToolUse` (`tool_response.stdout = "probe-tool-ok"`, `duration_ms`)
  > `Stop` (`last_assistant_message":"probe-ok"`)
- Conclusion: `PermissionRequest` is the authoritative request signal and fires
  before the dialog is answered. `PostToolUse` fires only after the approved
  call succeeds, so it is evidence of execution, not of the decision itself.
- Tag: [Verified]

### S1-CC-05 — Denied permission: is there an explicit resolution signal, and does `PostToolUse` fire?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181.
- Method: same driver with `--answer no`; the driver sent Esc to the permission
  dialog (`out/claude-code/tui-deny3.log`). `PROBE_RUN_ID=tui-deny3`.
- Raw observation (verbatim excerpt, `out/claude-code/tui-deny3.jsonl:1-10`):
  > `SessionStart` -> `UserPromptSubmit` -> `PreToolUse` -> `PermissionRequest` -> `SessionEnd`
  >
  > `SessionEnd` payload: `"reason":"prompt_input_exit"`
  >
  > No `PostToolUse`, no `PermissionDenied`, no resolution event.
- Conclusion: Denial is observable only as the **absence** of `PostToolUse` plus
  an interrupted turn. There is no documented or observed approval/denial
  result event in the hook stream. `PostToolUse` cannot distinguish
  user-approved from auto-allowed from hook-allowed, and its absence is
  ambiguous (denial, cancel, tool failure). Resolution must remain `inferred`.
- Tag: [Rejected] (as an authoritative resolution signal)

### S1-CC-06 — Are tool failure and API failure distinguishable from success and cancel?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181.
- Method:
  1. `claude -p --permission-mode default "TOOL_FAIL"` with the mock returning a
     `Read` of a missing file inside the workspace (`PROBE_RUN_ID=tool-fail2`).
  2. The first unauthenticated run (`PROBE_RUN_ID=smoke`) captured a real 401.
- Raw observation (verbatim excerpts):
  > `out/claude-code/tool-fail2.jsonl:7`:
  > `"hook_event_name":"PostToolUseFailure"`, `"tool_name":"Read"`, `"error":"File does not exist."`, `"is_interrupt":false`, `"duration_ms":13`
  >
  > `out/claude-code/smoke.jsonl:5`:
  > `"hook_event_name":"StopFailure"`, `"error":"authentication_failed"`, `"last_assistant_message":"Failed to authenticate. API Error: 401 OAuth access token is invalid."`
  >
  > `out/claude-code/tui-deny3.jsonl` has neither event after the denied call.
- Conclusion: Tool failures produce `PostToolUseFailure` with a string `error`
  and `is_interrupt`; turn-ending API failures produce `StopFailure` with a
  typed `error` and optional last text. Denial/cancel produces neither and ends
  the turn without `Stop`. Failure is distinguishable from success; cancel is
  distinguishable only by absence plus `SessionEnd`.
- Tag: [Verified]

### S1-CC-07 — When does `Notification` fire, and is it safe as an approval signal (RF-S1)?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181.
- Method: three TUI sessions: (a) permission dialog left unanswered for >6 s
  (`tui-approve` first run); (b) permission dialog answered immediately
  (`tui-deny3`); (c) plain-text turn left idle for 70 s
  (`drive_interactive.py --prompt PLAIN --idle-wait 70`).
- Raw observation (verbatim excerpts):
  > `out/claude-code/tui-approve.jsonl:7-9`: `PermissionRequest` at
  > `1792488581998`; `Notification` at `1792488588020`; payload
  > `"notification_type":"permission_prompt"`, `"message":"Claude needs your permission"` — 6.022 s later.
  >
  > `out/claude-code/tui-idle.jsonl:7`: `"notification_type":"idle_prompt"`,
  > `"message":"Claude is waiting for your input"` — 60.123 s after `Stop`.
  >
  > `out/claude-code/tui-deny3.jsonl`: no `Notification` (dialog answered in <6 s).
- Conclusion: `Notification` is a delayed, type-tagged reminder, not the
  request. It fires for both permission prompts and ordinary idle, so it fails
  the RF-S1 negative test as a permission signal. `PermissionRequest` is the
  immediate, typed signal; `notification_type` is still useful for display
  context.
- Tag: [Verified]

### S1-CC-08 — Hook runtime and whether the host waits (cold and warm)
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181, Node v24.20.0.
- Method: `PROBE_SLEEP_MS=3000` with `PROBE_SLEEP_EVENTS` set to one of
  `PreToolUse`, `PostToolUse`, `Stop`; print-mode runs with
  `--allowedTools=Bash`, timed with `date +%s%3N`. Hook duration is measured
  inside `probe.cjs` (`total_ms`); host waiting is inferred from the gap to the
  next event plus total process wall time.
- Raw observation (verbatim excerpts from timing records):
  > `timing2-pre-sleep`: `PreToolUse total_ms=3006.094`; `PostToolUse` started
  > 6.944 s after `PreToolUse` started; wall 10 897 ms vs 8 136 ms baseline.
  >
  > `timing2-post-sleep`: `PostToolUse total_ms=3005.422`; `Stop` started
  > 3.157 s later; wall 10 070 ms vs 8 136 ms baseline.
  >
  > `timing2-stop-sleep`: `Stop total_ms=3006.009`; `SessionEnd` started
  > 3.126 s later; wall 6 930 ms vs 4 155 ms baseline.
  >
  > Warm hook totals: 5.872–15.193 ms across all events. First hook of a new
  > TUI host: 190.5–347.0 ms. First hook of the first print-mode run: 42.3 ms.
- Conclusion: Command hooks run synchronously and the host waits: a 3 s
  PreToolUse hook delays the tool, a 3 s PostToolUse hook delays the turn end,
  and a 3 s Stop hook delays `SessionEnd` and process exit by ~3.1 s. Warm
  overhead is ~6–15 ms; first-hook overhead is ~0.2–0.35 s in a TUI session
  (warm OS cache, not a post-reboot cold start). A 1000 ms shim budget is
  feasible warm but tight cold; `async: true` is the documented non-blocking
  escape hatch, not tested at runtime.
- Tag: [Verified] (synchronous path); async path [Assumption] from docs.

### S1-CC-09 — Does `PermissionRequest` fire in non-interactive `-p` mode on 2.1.181?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181.
- Method: `claude -p --permission-mode default "TOOL_OK"` with the probe
  registered for `PermissionRequest`, both with no allow rule and with an
  explicit `permissions.ask: ["Bash(node -e *)"]` rule in the temp profile.
- Raw observation (verbatim excerpts):
  > `out/claude-code/tool-approve.jsonl`: `SessionStart` -> `UserPromptSubmit`
  > -> `PreToolUse` -> `Stop` -> `SessionEnd`; no `PermissionRequest`.
  >
  > Transcript tool result: `"content":"This command requires approval","is_error":true`
  >
  > `out/claude-code/ask-rule.jsonl`: same sequence; no `PermissionRequest`.
  >
  > Current docs: "In sessions that can't show a prompt, such as background
  > subagents in non-interactive mode, Claude Code still runs these hooks".
- Conclusion: On 2.1.181, `-p` mode auto-denies a tool that needs approval and
  does **not** run `PermissionRequest` hooks, contradicting the current docs.
  Interactive mode under a terminal does fire it. Any adapter that relies on
  `PermissionRequest` must treat headless sessions as a documented gap, or use
  the interactive/TUI surface.
- Tag: [Rejected] (documented non-interactive behavior not reproduced on this
  version)

### S1-CC-10 — Stable IDs, ordering, and subagent identification
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181.
- Method: inspect every captured payload; read
  <https://code.claude.com/docs/en/hooks>, `Common input fields` and
  `SubagentStart`/`SubagentStop`.
- Raw observation (verbatim excerpt):
  > `session_id` | Current session identifier
  > `prompt_id` | UUID identifying the user prompt currently being processed
  > `tool_use_id` | (tool events)
  > `agent_id` | Unique identifier for the subagent or in-process teammate the hook fires in.
  > `agent_type` | Agent name (for example, `"Explore"` or `"security-reviewer"`).
- Conclusion: `session_id`, `prompt_id`, and `tool_use_id` are stable
  identifiers observed in captures; `prompt_id` correlates all events of one
  turn, and permission requests correlate through the tool fields plus
  `prompt_id` (they have no `tool_use_id`). No sequence number or replay cursor
  is present in hook payloads, so ordering is delivery order only. Subagents are
  identifiable through `agent_id`/`agent_type` and `SubagentStart`/`SubagentStop`
  (docs-only; no subagent was run in this probe).
- Tag: [Verified] (IDs in runtime captures; subagent fields doc-only)

### S1-CC-11 — Does it run natively on Windows?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181, Node v24.20.0.
- Method: `claude --version`; `claude --help`; all captures above ran the native
  `claude.exe` from `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\`.
  Docs: <https://code.claude.com/docs/en/cli-reference> (`--ax-screen-reader`,
  `--settings`) and <https://code.claude.com/docs/en/hooks> (Windows
  PowerShell tab, `shell: "powershell"`).
- Raw observation (verbatim excerpt):
  > `2.1.181 (Claude Code)`
  >
  > On Windows, exec form requires `command` to resolve to a real executable
  > such as a `.exe`.
- Conclusion: The host, hooks, and permission dialog run natively on this
  Windows build; the probe used `node` in exec form. PowerShell is a documented
  hook shell, but the probe did not need it.
- Tag: [Verified]

### S1-CC-12 — Is the hook API stable and versioned?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Claude Code 2.1.181.
- Method: <https://code.claude.com/docs/en/hooks>, sections `Matcher patterns`,
  `Notification`, `SessionEnd`; compare documented version gates with the
  installed 2.1.181.
- Raw observation (verbatim excerpt):
  > `quota_auto_resume_*` ... require Claude Code v2.1.234 or later.
  > Matching `StopFailure` on `cloud_credential_error` requires Claude Code v2.1.267 or later
  > `SessionEnd` hooks have a default timeout of 1.5 seconds.
  > `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` ... Before v2.1.268 ...
- Conclusion: Events and fields are documented with explicit minimum-version
  gates, so the surface is versioned in prose but the docs page itself has no
  version selector. Two observed drifts matter: docs describe non-interactive
  `PermissionRequest` (not reproduced on 2.1.181) and reference newer timeout
  and matcher behavior. Pin the host version in the adapter and re-verify
  payload fields per version.
- Tag: [Verified] (documented version gates and observed drift)


## Host extension: Codex CLI records (S1-3H)

These records use a host-specific ID prefix. Source:
`docs/spikes/phase-0-shards/s1-third-host.md`.

### S1-3H-01 — Does Codex document a lifecycle hook mechanism that runs on Windows?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / Codex CLI 0.155.1 installed.
- Method: <https://developers.openai.com/codex/hooks>, sections `Hooks` and
  `Config shape`.
- Raw observation (verbatim excerpt):
  > Hooks are an extensibility framework for Codex. They let you run scripts or
  > MCP tools during the agentic loop ...
  >
  > Hooks run at different points in a conversation:
  >
  > | During a turn | `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop` |
  > | When you interrupt an active turn | `Interrupt` (doesn't run for subagents) |
  > | When a session or subagent starts | `SessionStart`, `SubagentStart` |
  > | When the main thread ends | `SessionEnd` (doesn't run for subagents) |
  >
  > `commandWindows` is an optional Windows-only command override.
- Conclusion: Codex documents a lifecycle hook framework with distinct
  permission, turn-end, session-end, and subagent events, plus a Windows-only
  command override. The mechanism is `hooks.json` or inline `[hooks]` in
  `config.toml`; commands receive JSON on stdin.
- Tag: [Verified]

### S1-3H-02 — Does the installed Codex 0.155.1 expose hooks?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / `codex-cli 0.155.1`, Node v24.20.0.
- Method: `codex features list` in the throwaway profile.
- Raw observation (verbatim excerpt):
  > `hooks                                    stable             true`
- Conclusion: hooks are a stable, enabled feature in the installed version, not
  a docs-only or future feature.
- Tag: [Verified]

### S1-3H-03 — Does a plain-text turn produce turn-end and session-end signals?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Codex CLI 0.155.1, Node v24.20.0.
- Method: `codex exec --skip-git-repo-check --dangerously-bypass-hook-trust --json "Reply with exactly: PROBE_TURN_END"` with `CODEX_HOME=spikes/s1-host-signals/codex/profile` and `S1_RUN_LABEL=turn-end`; probe `spikes/s1-host-signals/codex/probe-hook.mjs`.
- Raw observation (verbatim excerpts, `out/codex/turn-end.jsonl`):
  - line 1 `SessionStart`: `"source":"startup"`, `"permission_mode":"bypassPermissions"`, `session_id:"01a15899-afe7-7c40-8227-f09e626adbb6"`.
  - line 2 `UserPromptSubmit`: `"turn_id":"01a15899-b2f0-70e0-bd70-1513094a00f9"`, `"prompt":"Reply with exactly: PROBE_TURN_END"`.
  - line 3 `Stop`: `"turn_id":"01a15899-b2f0-70e0-bd70-1513094a00f9"`, `"stop_hook_active":false`, `"last_assistant_message":"PROBE_TURN_END"`.
  - line 4 `SessionEnd`: `"reason":"other"`.
- Conclusion: `Stop` is an authoritative turn boundary that carries a turn ID
  and the final assistant message; `SessionEnd` is a separate session boundary.
  `Stop` is not a verified task-completion signal. Limit: the session ran with
  `permission_mode: bypassPermissions`, so this capture says nothing about
  approvals.
- Tag: [Verified]

### S1-3H-04 — Are subagent start/stop signals identifiable?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Codex CLI 0.155.1.
- Method: same `codex exec` invocation with `S1_RUN_LABEL=subagent`, prompt
  `Use the spawn_agent tool to launch one subagent ...`.
- Raw observation (verbatim excerpts, `out/codex/subagent.jsonl`):
  - line 3 `SubagentStart`: `"agent_id":"01a158a0-2949-7503-bd5b-a2b9cb06acbc"`, `"agent_type":"default"`, parent `"session_id":"01a158a0-03e7-7d11-97c0-50e2648396eb"`.
  - line 4 `SubagentStop`: same `agent_id` / `agent_type`; parent `session_id` unchanged.
  - lines 5–6 `Stop`, `SessionEnd` for the parent turn/session.
- Conclusion: subagents are identifiable by `agent_id` and `agent_type`; the
  parent session is the hook's `session_id`. `SubagentStart`/`SubagentStop`
  fired in a real run.
- Tag: [Verified]

### S1-3H-05 — Can a real permission request be captured?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Codex CLI 0.155.1.
- Method: `node spikes/s1-host-signals/codex/probe-app-server.mjs` — documented
  app-server `initialize`, `thread/start` (`approvalPolicy: "on-request"`,
  `sandbox: "read-only"`), `turn/start` asking for a file write; also attempted
  `codex exec -a on-request -s read-only` and `-s workspace-write` runs.
- Raw observation (verbatim excerpt, `out/codex/permission-appserver.protocol.jsonl:31`):
  > `{"method":"item/commandExecution/requestApproval","id":0,"params":{"kind":"command","threadId":"01a1589f-030d-7691-ad07-5a8c0c85828b","turnId":"01a1589f-0517-7cc1-93be-5ac6d9618a87","itemId":"exec-b2275e07-45f2-4587-bb1c-b9b4845f72dd",...}}`
  >
  > No `PermissionRequest` record exists in `out/codex/`; the app-server session
  > produced no hook records at all.
- Conclusion: the host did surface a real approval request through the
  documented app-server interface, but the probe hook was not consulted because
  the throwaway profile has no persisted hook-trust record and app-server has no
  non-interactive trust bypass. `codex exec` does not surface approvals at all:
  it blocked the same writes by policy. Runtime permission capture is therefore
  **[Blocked]**; `PermissionRequest` remains verified from official docs
  (S1-3H-06) and unscored at runtime.
- Tag: [Blocked]

### S1-3H-06 — Is `PermissionRequest` an authoritative, typed approval signal, and does it block?
- Date / Windows build / tool versions: 2026-10-20 / n/a (doc-only) / Codex CLI 0.155.1 installed.
- Method: <https://developers.openai.com/codex/hooks>, section
  `Hooks > PermissionRequest`; `Config shape`; `Run hooks in the background`.
- Raw observation (verbatim excerpt):
  > `PermissionRequest` runs when Codex is about to ask for approval, such as a
  > shell escalation or managed-network approval. It can allow the request, deny
  > the request, or decline to decide and let the normal approval prompt continue.
  > It doesn't run for commands that don't need approval.
  >
  > Fields ... `turn_id`, `tool_name`, `tool_input`, `tool_input.description`.
  >
  > By default, Codex waits for a command hook to finish before continuing the
  > operation that triggered it. Set `async` to `true` to run a command hook in
  > the background while Codex continues.
  >
  > Background hooks can't block, approve, rewrite, or otherwise control the
  > operation that triggered them. Use synchronous hooks for tool policies,
  > permission decisions, prompt rejection, or turn continuation.
- Conclusion: `PermissionRequest` is a documented, typed approval-request event
  distinct from `UserPromptSubmit`; a synchronous hook can allow, deny, or defer
  and therefore blocks the host. It exposes no user decision afterward, so it is
  an approval signal, not a resolution signal. Limit: the runtime hook capture is
  S1-3H-05 [Blocked].
- Tag: [Verified]

### S1-3H-07 — RF-S1 negative test: does ordinary progress fire approval?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Codex CLI 0.155.1.
- Method: the plain-text and subagent sessions above; inspect every captured
  `hook_event_name`.
- Raw observation (verbatim event sequence):
  - `turn-end`: `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`.
  - `subagent`: `SessionStart`, `UserPromptSubmit`, `SubagentStart`,
    `SubagentStop`, `Stop`, `SessionEnd`.
  - No `PermissionRequest` in either file.
- Conclusion: ordinary progress and a completed plain-text turn do not fire the
  approval event. The negative test passes for the permission event. Limit: the
  positive permission capture is [Blocked], so this proves non-firing only.
- Tag: [Verified]

### S1-3H-08 — How long does a hook take, and does the host wait?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Codex CLI 0.155.1, Node v24.20.0.
- Method: each probe recorded `hook_process_ms` around stdin read/JSON parse;
  wall-clock process lifetime including Node start-up. Warm runs (OS file cache
  warm; no cold-boot run).
- Raw observation (verbatim):
  - `turn-end.jsonl`: `hook_process_ms` 7, 8, 5, 4 for SessionStart,
    UserPromptSubmit, Stop, SessionEnd.
  - `subagent.jsonl`: `hook_process_ms` 5, 4, 4, 5, 5, 4.
- Conclusion: warm hook runtime was 4–8 ms per invocation. Docs state Codex
  waits for synchronous hooks by default and supports `async: true` for
  background execution. Limit: cold-start latency and the host's total
  added delay were not measured (RF-S2 still open).
- Tag: [Verified]

### S1-3H-09 — Does Codex run natively on Windows?
- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / `codex-cli 0.155.1`.
- Method: `codex --version`, the native `codex exec` runs above, and the hooks
  `commandWindows` field.
- Raw observation (verbatim excerpt):
  > `codex-cli 0.155.1`
  >
  > `commandWindows` is an optional Windows-only command override.
- Conclusion: the installed CLI runs as a native Windows executable on this
  Windows build and executed the probe hooks. Limit: no separate packaged
  installer observation beyond the installed npm distribution.
- Tag: [Verified]


## Scorecard and D-01 (Task 0.5)

Selection rule (PRD §16.1): highest count of authoritative signals among
{approval, resolution, turn boundary, completion, failure}; integration
convenience breaks ties.

| Host | Approval | Resolution | Turn boundary | Completion | Failure | Count | Result |
|---|---|---|---|---|---|---|---|
| OpenCode v2.0.32 | `permission.asked` | `permission.replied` (`once`/`reject`) | `session.execution.succeeded\|failed\|interrupted` | `succeeded` + idle outcome | `failed` + structured error | **5/5** | **Selected** |
| Claude Code 2.1.181 | `PermissionRequest` (TUI) | rejected; no event | `Stop` | `Stop` (turn/session) | `StopFailure` / `PostToolUseFailure` | 4/5 | Not selected |
| Codex CLI 0.155.1 | `PermissionRequest` (docs; runtime blocked) | rejected; no hook | `Stop` | rejected; boundaries only | rejected; `Interrupt` only | 2/5 | Not selected |

**D-01 = OpenCode.** It is the only evaluated host with all five authoritative
signals. The result is not a tie, so integration convenience is not needed, but
OpenCode also has the lowest-friction surface for the first adapter: an
in-process plugin and a non-blocking event subscription. The adapter MUST use
the runtime names, not the documentation example: `session.idle` was absent
(0/260), and `permission.replied` was present but undocumented in V2.

### Q-01 — Which host exposes the most reliable lifecycle signals?

**Answered: OpenCode.** 5/5 authoritative signals at runtime, 260/260 unique
event IDs, monotonic per-session `durable.seq`, durable idle outcomes, and a
child-session `parentID`. Residual risk: the V2 API is explicitly experimental
and the runtime names drift from the docs. Pin v2.0.32 behavior and re-probe on
upgrades.

### Q-02 — Can the first host distinguish blocking questions from plain text?

**Answered: yes for permission requests; partly for arbitrary questions.**
OpenCode permission requests are typed `Permission.Request` objects
(`id`, `action`, `resources`), while ordinary input is `Session.Message.User`
with `type:"user"`. The dedicated question tool was not exercised at runtime;
that part is documentation-based. Claude Code exposes `AskUserQuestion` through
`PreToolUse` (docs-only). Codex has typed permission prompts but no
arbitrary-question hook.

### Q-03 — Does the host expose task-level, session-level, or both completion scopes?

**Answered: session-level only for the evaluated hosts.** OpenCode
`session.execution.succeeded` carries only `{sessionID}` and binds to a
session idle message; there is no task scope. Claude Code `Stop` is a turn /
session boundary, not semantic success. Codex `Stop`/`SessionEnd` are
boundaries only. The PRD's `taskId` rule (D-13) therefore stays: task scope only
when a host exposes a real task concept.

### Q-08 — Which host event identifiers are stable enough for persistent deduplication?

**Answered: OpenCode is the strongest; use the event envelope plus durable
sequence.** Across seven captures, 260 events had 260 unique `evt_` IDs and no
duplicates; `durable.seq` was strictly increasing per session. Permission IDs
(`^per`) and message IDs (`^msg_`) are stable. The live stream can miss events
during subscription startup, so the adapter must backfill with
`session.log?after=<seq>&follow=true` (experimental) or tolerate the first
event being absent. Claude Code has `session_id`, `prompt_id`, and
`tool_use_id`, but no sequence cursor. Codex has `session_id`, `turn_id`, and
`agent_id`, but no sequence.

### RF-S1 / RF-S2 / RF-S3 status

- **RF-S1 (false approval):** passed for OpenCode (S1-18: 0 `permission.asked`
  and no non-empty pending snapshot in a progress-only turn), Claude Code
  (S1-CC-03/07: ordinary text fires no `PermissionRequest`; delayed
  `Notification` is not an approval signal), and Codex (S1-3H-07: no
  `PermissionRequest` in plain-text or subagent turns).
- **RF-S2 (host delay):** measured. OpenCode uses an async subscription; Claude
  Code command hooks block by default (3 s hook delayed tool/turn/exit by
  ~3.1 s; warm 6–15 ms; `async:true` documented but not runtime-tested); Codex
  warm hooks 4–8 ms, sync by default with documented `async:true`.
- **RF-S3 (terminal closed):** measured for audio, TTS, and toast. All three
  succeeded with the invoking shell gone; toast registration is independent of
  the terminal. Focus/click-to-focus did not complete a real toast-activation
  path and is recorded as partial.

### Fixtures

The chosen host's raw captures are frozen under
[`../../tests/fixtures/opencode/`](../../tests/fixtures/opencode/README.md).
The fixture README names the host version, date, and signals in each file. The
raw stream is sanitized only for absolute checkout paths and global
instruction payloads; event names, IDs, payloads, and ordering are unchanged.
