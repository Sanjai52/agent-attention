# S1 — OpenCode runtime probe shard (Task 0.2)

Status: **runtime capture complete** for the seven sessions listed below. This
shard is private to Task 0.2; the controller merges the proposed records and
matrix column into `docs/spikes/s1-results.md` and
`docs/host-signal-matrix.md`.

- Host: **OpenCode v2.0.32** (`opencode --version` → `opencode v2.0.32`)
- OS: **Windows 10.0.26300.0** (`[System.Environment]::OSVersion.Version.ToString()`)
- Node: **v24.20.0**
- Date: **2026-10-20**
- Probe code: `spikes/s1-host-signals/opencode/`
- Captures: `spikes/s1-host-signals/out/opencode/*.jsonl` and `run.json` (gitignored)
- Method summary: private `OPENCODE_CONFIG` file + `opencode serve` + documented
  HTTP API; no change to `~/.config/opencode`.

Doc references use the URLs and access date already recorded in
`docs/spikes/s1-results.md` (access date **2026-10-20**). The installed host is
v2.0.32, not the doc-site version, so runtime names are treated separately from
documented names.

## Method (exact)

1. Private config: `spikes/s1-host-signals/opencode/config/opencode.json`:
   - `model`: `github-copilot/claude-haiku-4.5` as the file default; the driver
     overrides it per session in `POST /api/session`. Six captures requested
     `opencode/deepseek-v4.1-flash-free`; `error-invalid-model` deliberately
     requested `github-copilot/claude-haiku-4.5` and received
     `provider.invalid-request` (S1-17).
   - `plugins`: absolute path to `config/probe` (local plugin directory); the
     path is checkout-specific and must be edited for another worktree.
   - `permissions`: `shell * = ask`, plus `read`/`glob`/`grep`/`edit = allow`.
2. Each capture starts a private server from the empty `sandbox/` directory:

   ```powershell
   $env:OPENCODE_CONFIG = "<repo>\spikes\s1-host-signals\opencode\config\opencode.json"
   $env:OPENCODE_CONFIG_PROJECT_DISABLE = "1"
   $env:OPENCODE_SERVER_PASSWORD = "s1-probe-password"
   $env:S1_PROBE_LOG = "<repo>\spikes\s1-host-signals\out\opencode\<scenario>.jsonl"
   opencode serve --hostname 127.0.0.1 --port <47840+index>
   ```

3. The driver (`run-capture.mjs`) uses the documented HTTP API with HTTP Basic
   auth (`opencode:<password>`):
   - `POST /api/session` (with explicit `model`)
   - `POST /api/session/{sessionID}/prompt`
   - `GET /api/session/{sessionID}/permission`
   - `POST /api/session/{sessionID}/permission/{requestID}/reply`
     (`{"decision":"once"}` or `{"decision":"reject"}`)
   - `POST /api/session/{sessionID}/interrupt` (`{"continue":false}`)
   - `GET /api/session/{sessionID}` for the durable session outcome.
4. The probe plugin (`config/probe/index.ts`) logs:
   - `plugin.setup` with `ctx.app` and `ctx.location`,
   - every event from `ctx.event.subscribe({ signal })` verbatim,
   - a documented `ctx.session.hook("prompt", ...)` payload,
   - `ctx.permission.list({ sessionID })` every 250 ms, recording only changes,
   - a terminal binding: on `session.execution.*` it reads
     `ctx.session.context()` and `ctx.session.get()` and logs the durable idle
     message and session outcome.
5. Seven independent sessions were run; each used a fresh server and a truncated
   JSONL file. All seven reached a `session.execution.*` terminal event.

### Config isolation limitation

OpenCode v2.0.32 always merges the user's global
`~/.config/opencode/opencode.jsonc`. That file was **not modified**; its
`superpowers` plugin and two MCP servers were active during captures.
`OPENCODE_CONFIG_CONTENT` was used to disable the MCP servers for faster startup.
A `plugin.updated` event and skill guidance in model reasoning confirm the
global plugin loaded. No global plugin event was observed that changes the
conclusions below; the probe logs the whole public stream regardless.

## Runtime inventory

Across the seven captures: **260 events, 260 unique `evt_` IDs, 0 duplicate
IDs**. `session.idle` = **0**, `session.error` = **0**,
`permission.asked` = **2**, `permission.replied` = **2**.

Observed event types (count):

```text
agent.updated 7, command.updated 17, integration.updated 7,
mcp.resources.changed 10, mcp.status.changed 24, model.updated 7,
permission.asked 2, permission.replied 2, plugin.updated 7,
provider.updated 7, reference.updated 7, session.created 1,
session.execution.failed 1, session.execution.interrupted 2,
session.execution.started 8, session.execution.succeeded 5,
session.inbox.delivered 8, session.inbox.enqueued 8,
session.instructions.updated 10, session.reasoning.delta 18,
session.reasoning.ended 6, session.reasoning.started 6,
session.step.ended 7, session.step.failed 3, session.step.started 10,
session.step.streamed 8, session.text.delta 7, session.text.ended 5,
session.text.started 5, session.tool.called 3, session.tool.failed 1,
session.tool.input.ended 3, session.tool.input.started 3,
session.tool.progress 2, session.tool.success 2, session.usage.updated 8,
shell.created 1, shell.exited 1, skill.updated 7, vcs.branch.updated 7,
websearch.updated 7
```

Event envelope observed on every event:

```json
{"id":"evt_…","created":1792489223731,"type":"permission.asked","durable":{"aggregateID":"ses_…","seq":8,"version":1},"location":{"directory":"…"},"data":{…}}
```

`durable.seq` was strictly increasing per session in all eight observed
aggregates; the child session started at `seq:0`, the parent at `seq:1` because
the plugin subscription began after the parent `session.created`.

Quoting convention: a probe writes each stream event as
`{"seq":…,"ts":…,"kind":"event","event":{…}}`. Where a record below quotes a
capture line whose `kind` is `"event"`, the quoted object is the inner `event`
(envelope `id`/`created`/`type`/`durable`/`data` included, `location` omitted as
noted); probe records (`kind` other than `"event"`) are quoted whole. JSON is
re-indented for readability by the repository formatter; field names and values
are verbatim.

---

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

## Proposed OpenCode matrix column

Replace the OpenCode column in `docs/host-signal-matrix.md` with:

| Criterion             | Proposed OpenCode cell                                                                                                                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approval signal       | `[Verified]` Runtime `permission.asked` with `data.id` (`^per`), `action`, `resources`, `save`, `source` (S1-12; `out/opencode/permission-allow.jsonl:34`). Docs: V2 CLI plugins `Events`.                                                                                                            |
| Resolution signal     | `[Verified]` Runtime `permission.replied` with `{sessionID, requestID, reply}`; `once` and `reject` observed (S1-12; allow:36, deny:35). V2 docs omit the name; polling is a lossy fallback (S1-13).                                                                                                  |
| Blocking input        | `[Verified]` `Permission.Request` (typed id/action/resources) is structurally distinct from `Session.Message.User` (`type:"user"`, `text`) in the same capture (S1-12/S1-18). Docs: `question` action. Question-tool runtime not exercised.                                                           |
| Turn boundary         | `[Verified]` Runtime terminal event is `session.execution.succeeded                                                                                                                                                                                                                                   | failed | interrupted`, not `session.idle`(S1-14 rejected;`session.idle` = 0/260). Session-level, no per-message boundary. |
| Completion            | `[Verified]` `session.execution.succeeded` carries `{sessionID}`; binds to durable idle message `outcome:"succeeded"` (S1-15/S1-16).                                                                                                                                                                  |
| Failure               | `[Verified]` `session.execution.failed` carries `Session.StructuredError`; abort is `interrupted` + `reason:"user"`; permission reject is `interrupted` + `reason:"shutdown"`, no idle message, no session outcome, assistant message `finish:"error"`/`aborted` (S1-17). No runtime `session.error`. |
| Stable IDs / sequence | `[Verified]` 260/260 unique `evt_` IDs, monotonic `durable.seq` per session (S1-20). Live stream can miss the first event; backfill via `session.log`.                                                                                                                                                |
| Subagents             | `[Verified]` Child `session.created.data.parentID`, `session.get().parentID`, child prompt hook, child terminal event (S1-19).                                                                                                                                                                        |
| Non-blocking          | `[Verified]` Docs pattern is `void` async subscription + cleanup; runtime completed all seven sessions while logging (S1-21). No latency measurement; docs note slow consumers backpressure the shared source.                                                                                        |
| Windows-native        | `[Verified]` Runtime on Windows 10.0.26300.0 with `opencode v2.0.32`; docs publish native Windows x64/ARM64 binaries (S1-10).                                                                                                                                                                         |
| Stability             | `[Verified]` OpenAPI 3.1.0 `info.version` 0.0.1, explicitly experimental (S1-11). Runtime event names diverge from docs (`session.idle` absent), so pin the observed v2.0.32 names and re-probe on upgrades.                                                                                          |

Suggested scorecard note for the OpenCode row: authoritative count **5/5** for
{approval, resolution, turn boundary, completion, failure} at runtime, with the
turn-boundary signal being `session.execution.*` rather than the documented
`session.idle`.

## Proposed updates to `docs/spikes/s1-results.md`

1. Header status: replace “Runtime captures, the RF-S1 negative test, and Task
   0.5 scoring remain pending” with “Runtime captures and the RF-S1 negative
   test complete (S1-12–S1-21); Task 0.5 scoring pending.”
2. Required-evidence checklist row `0.2`: change status to **Complete** and cite
   S1-12–S1-21.
3. In “Exact signal and identifier names”, change:
   - `Permission resolution` from `[Assumption]` / “Not re-listed in V2 docs” to
     `permission.replied` — **confirmed at runtime in v2.0.32** (`data:
{sessionID, requestID, reply}`), even though V2 docs omit it.
   - `Session idle` from “Confirmed by V2 example” to **`session.idle` rejected
     at runtime in v2.0.32** (0/260 events); use `session.execution.*` instead.
   - `Session error` to “not observed at runtime; use
     `session.execution.failed` with `Session.StructuredError`”.
   - Add rows for `session.execution.interrupted` (`data.reason` `user` |
     `shutdown`) and `session.execution.started`.
4. Change S1-02 tag from `[Assumption]` to `[Verified]` and add the S1-12
   capture citation; retain the V1-doc limit.
5. Append S1-04, S1-05, and S1-06 limit sentences: “S1-14 rejected the
   documented `session.idle` event on v2.0.32; the runtime terminal events and
   idle-message binding are recorded in S1-14–S1-17.”
6. Add the S1-12–S1-21 records from this shard in order, without renumbering
   existing IDs.

## Limitations / blockers

- The host is v2.0.32. The docs site is unversioned “V2 current”; one documented
  example event (`session.idle`) is absent at runtime. Re-probe on every host
  upgrade.
- Global config merges into private runs. The global `superpowers` plugin was
  active; no global plugin event was observed to affect the conclusions, but
  strict isolation was not possible without modifying the user's config.
- Permission polling used a 250 ms interval and missed the deny request (22 ms
  lifetime). The authoritative resolution capture is `permission.replied`.
- Question-tool (blocking input) runtime was not exercised; the matrix cell
  relies on the documented `question` action plus the captured
  permission-vs-plain-text distinction.
- No latency measurement for the non-blocking cell; that remains the S1-09
  documentation result.
- Plugin `cleanup` was not captured on killed private servers; the manual smoke
  run logged it.

## Reproduction

```powershell
# from the repository root of this worktree
node spikes/s1-host-signals/opencode/run-capture.mjs
node spikes/s1-host-signals/opencode/analyze.mjs
```

Captures are written to `spikes/s1-host-signals/out/opencode/` and are
gitignored. The probe code is throwaway and MUST NOT be promoted to an adapter.
