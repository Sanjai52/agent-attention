# S1 — Third host: Codex CLI

Status: probed 2026-10-20 on Windows 10.0.26300.9711 with `codex-cli 0.155.1`.
Turn-end, session-end, and subagent hooks were captured. A genuine approval
request was produced through the documented app-server surface, but the probe
hooks were skipped as untrusted; the permission hook therefore remains
documentation-verified only and its runtime capture is **[Blocked]**.

- Chosen host: **Codex CLI**.
- Why: Codex 0.155.1 exposes a documented, Windows-native hooks framework with
  typed `PermissionRequest`, `Stop`, `SessionEnd`, `SubagentStart`, and
  `SubagentStop` events, and `commandWindows` for Windows command overrides.
  Gemini CLI 0.42.0 also documents hooks, but its `Notification` hook is
  observability-only (it cannot decide a permission) and its docs expose no
  approval-resolution or failure hook. Codex's approval event is stronger.
- Probe: [`spikes/s1-host-signals/codex/`](../../../spikes/s1-host-signals/codex/README.md)
- Captures: `spikes/s1-host-signals/out/codex/*.jsonl` (gitignored)
- Matrix column proposed below; Task 0.5 owns the final scorecard.

## Official documentation

Access date for every URL: **2026-10-20**. Documentation is the current Codex
docs; the installed CLI version is recorded separately so doc evidence is not
mistaken for a runtime capture.

| Ref | URL | Section relied on |
|---|---|---|
| CX-HOOKS | <https://developers.openai.com/codex/hooks> | `Hooks` (event table), `Config shape`, `Common input fields`, `Run hooks in the background`, `Hooks > PermissionRequest`, `Hooks > Stop`, `Hooks > SessionEnd`, `Hooks > SubagentStart`, `Hooks > SubagentStop`, `Hooks > Interrupt`, `Turn hooks off` |
| CX-APPSERVER | <https://developers.openai.com/codex/app-server> | `Approvals > Command execution approvals` |

Installed-version evidence:

```text
$ codex --version
codex-cli 0.155.1

$ codex features list
...
hooks                                    stable             true
```

## Records

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

## Proposed matrix column

| Criterion | Proposed cell | Evidence |
|---|---|---|
| Approval signal | [Verified] `PermissionRequest` (typed; can allow/deny/defer). Runtime capture [Blocked]. | S1-3H-06, S1-3H-07 |
| Resolution signal | `unsupported` — no hook reports the user's decision; `PermissionRequest` only lets a hook decide. | S1-3H-06 |
| Blocking input | `partial` — permission prompts are typed and distinct from `UserPromptSubmit`; no hook for arbitrary questions. | S1-3H-06, S1-3H-03 |
| Turn boundary | [Verified] `Stop` with `turn_id` + `last_assistant_message`. | S1-3H-03 (`turn-end.jsonl:3`) |
| Completion | `unsupported` — `Stop`/`SessionEnd` are boundaries, not verified task success. | S1-3H-03 |
| Failure | `partial` — documented `Interrupt` marks user cancellation; no failure/error hook. | CX-HOOKS `Hooks > Interrupt` |
| Stable IDs / sequence | [Verified] IDs: `session_id`, `turn_id`, `agent_id`; no sequence number in hook payloads. | S1-3H-03, S1-3H-04 |
| Subagents | [Verified] `SubagentStart`/`SubagentStop` with `agent_id`, `agent_type`. | S1-3H-04 (`subagent.jsonl:3-4`) |
| Non-blocking | [Verified] conditional — sync by default; `async: true` runs in background (cannot decide). Warm 4–8 ms. | S1-3H-06, S1-3H-08 |
| Windows-native | [Verified] native CLI on Windows build; `commandWindows`. | S1-3H-09 |
| Stability | [Verified] `hooks` is a `stable` feature in 0.155.1 and officially documented. | S1-3H-01, S1-3H-02 |

Authoritative count for {approval, resolution, turn boundary, completion,
failure} = **2** (approval, turn boundary); failure is partial, resolution and
completion are unsupported. This is a proposed count for Task 0.5, not a D-01
decision.

## Limitations

- Permission runtime capture is [Blocked]: `codex exec` blocks by policy rather
  than asking, and app-server skipped the untrusted probe hooks. A TUI `/hooks`
  trust step or a persisted trust hash would be needed to close it.
- `Interrupt` was not captured; the hook is documentation-only here.
- Cold-start hook latency and the host's total added delay were not measured.
- The probe profile uses `--dangerously-bypass-hook-trust`; evidence therefore
  shows hook payloads, not the trust-review UX.
- Codex docs are not patch-versioned; the installed `0.155.1` version is the
  runtime anchor.
