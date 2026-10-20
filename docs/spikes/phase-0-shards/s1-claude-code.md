# S1 — Claude Code host signals (private shard)

Status: Task 0.3 runtime probe complete for hook registration, permission
approval/denial, plain-text turn end, tool success/failure, API failure, idle
notification, and session end. Model output was mocked because the installed
OAuth token is expired; the host, hooks, and permission dialog were real.

- Host: `claude 2.1.181 (Claude Code)`, installed at
  `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`
- OS: Windows 10.0.26300.9711; Node v24.20.0; Python 3.11.9 + pywinpty 3.0.5
- Probe: `spikes/s1-host-signals/claude-code/` (throwaway)
- Captures: `spikes/s1-host-signals/out/claude-code/*.jsonl` (gitignored)
- Access date for every URL: **2026-10-20**

## Documentation set

| Ref | Official URL | Section(s) relied on |
|---|---|---|
| CC-HOOKS | <https://code.claude.com/docs/en/hooks> | `Hook lifecycle`; `Configuration`; `Matcher patterns`; `Hook input and output > Common input fields`; `Exit code output`; `JSON output`; `Hook events` sections `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `Stop`, `StopFailure`, `SessionEnd`, `SubagentStart/Stop` |
| CC-CLI | <https://code.claude.com/docs/en/cli-reference> | `CLI flags`: `--settings`, `-p/--print`, `--permission-mode`, `--allowedTools`, `--ax-screen-reader` |
| CC-PERM | <https://code.claude.com/docs/en/permissions> | Permission modes; project allow rules and workspace trust |

Docs are published as a single "current" version with no per-release version
selector. The installed CLI is therefore recorded separately, and drift is called
out in S1-CC-09 and S1-CC-12.

## Exact hook events and payload fields (observed on 2.1.181)

| Event | When it fired (observed) | Event-specific fields in the captured payload |
|---|---|---|
| `SessionStart` | Start of every host process | `source` (`startup`) |
| `UserPromptSubmit` | Prompt submitted | `prompt`, `permission_mode`, `prompt_id` |
| `PreToolUse` | Before every tool call, before the permission decision | `tool_name`, `tool_input`, `tool_use_id`, `permission_mode`, `effort.level` |
| `PermissionRequest` | When the permission dialog is shown (interactive TUI only; see S1-CC-09) | `tool_name`, `tool_input`, `permission_suggestions`, `permission_mode`, `effort.level`; **no `tool_use_id`** |
| `PostToolUse` | After a tool call succeeds | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms` |
| `PostToolUseFailure` | After a started tool call fails | `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt`, `duration_ms` |
| `Notification` | Delayed reminder; type in `notification_type` | `message`, optional `title`, `notification_type` |
| `Stop` | Main agent finished responding normally | `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons` |
| `StopFailure` | Turn ended on an API error | `error`, optional `error_details`, optional `last_assistant_message` |
| `SessionEnd` | Session terminated | `reason` (`other`, `prompt_input_exit`, `clear`, `resume`, `logout`) |

All events also carry `session_id`, `transcript_path`, `cwd`, and
`hook_event_name`; most carry `prompt_id` after the first prompt (absent on
`SessionStart` and on `SessionEnd` when no prompt was submitted).

## Records

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

## Proposed matrix cells

| Criterion | Proposed cell | Evidence |
|---|---|---|
| Approval signal | `[Verified]` — `PermissionRequest` (immediate, typed, interactive) | S1-CC-04, `tui-approve.jsonl:17` |
| Resolution signal | `[Rejected]` — no resolution event; approve inferred from `PostToolUse`, deny from absence/interruption | S1-CC-05, `tui-deny3.jsonl:1-10` |
| Blocking input | `[Verified]` — `AskUserQuestion` is a tool event (`PreToolUse` matcher on any tool) and plain text ends with `Stop`; docs-only, no runtime AskUserQuestion capture | S1-CC-01, S1-CC-03; docs `PreToolUse` |
| Turn boundary | `[Verified]` — `Stop` with `last_assistant_message`; also `StopFailure` | S1-CC-03, S1-CC-06 |
| Completion | `[Verified]` — `Stop` = turn/session finished normally; not semantic task verification | S1-CC-03 |
| Failure | `[Verified]` — `StopFailure.error` and `PostToolUseFailure.error`/`is_interrupt` | S1-CC-06 |
| Stable IDs / sequence | `[Verified]` — `session_id`, `prompt_id`, `tool_use_id`; no sequence cursor | S1-CC-10 |
| Subagents | `[Verified]` — `agent_id`/`agent_type`, `SubagentStart`/`SubagentStop` (docs-only) | S1-CC-10 |
| Non-blocking | `[Verified]` — blocking by default (measured); `async: true` documented; async path not runtime-tested | S1-CC-08; docs `async` |
| Windows-native | `[Verified]` — native `claude.exe`, hooks and TUI exercised | S1-CC-11 |
| Stability | `[Verified]` — documented version gates, but unversioned docs and observed drift | S1-CC-12 |

Authoritative count among {approval, resolution, turn boundary, completion,
failure}: **4 of 5** (approval, turn boundary, completion, failure). Resolution
is the missing signal.

## Direct answers to the Task 0.3 questions

- **Which hook is authoritative for approvals, and which for input requests?**
  Approvals: `PermissionRequest` (not `Notification`, which is a 6 s-delayed
  reminder and also fires on idle). Input questions: `AskUserQuestion` arrives as
  a tool call, so `PreToolUse` with `tool_name: "AskUserQuestion"`; no separate
  question hook was observed.
- **Does `PreToolUse` fire for auto-approved or read-only tools?** Yes. It fired
  for `Read` (S1-CC-06) and for `Bash` allowed by `--allowedTools=Bash`
  (`timing2-tool-baseline.jsonl`). It runs before the permission decision, so it
  cannot be treated as an approval signal.
- **Does `PostToolUse` fire after denial?** No. Denial produced
  `PermissionRequest` followed by `SessionEnd`, with no post-tool event.
- **Can `PostToolUse` distinguish approve from deny?** No. It proves the tool
  ran and succeeded. It cannot distinguish user approval, an allow rule, or a
  hook decision, and its absence is ambiguous (denial, cancel, or failure).
- **When does `Notification` fire and what fields does it carry?** On type-based
  conditions: `permission_prompt` after ~6 s unanswered, `idle_prompt` after
  ~60 s idle, plus auth/elicitation/quota/agent types. Payload: `message`,
  optional `title`, `notification_type`. It is unsuitable as the approval
  signal (RF-S1).
- **Do hooks block the host?** Yes, command hooks are synchronous by default.
  Measured delays propagate to the tool call, turn end, and process exit.
  `async: true` is documented for background hooks; not measured.

## Limitations

- The account's OAuth token expired 2026-06-18; live model calls fail with
  `401 OAuth access token is invalid`. All authenticated captures use a local
  mock of `/v1/messages`. The model is mocked; hook payloads, ordering,
  permission dialogs, and blocking behavior are host-produced.
- Permission approve/deny was delivered through a pseudo-console (`pywinpty`)
  as real TUI keystrokes. No approval input was sent to the agent.
- Cold-start numbers are first-hook-of-process with a warm OS cache, not
  post-reboot.
- No subagent session was run; subagent fields are documentation-only.
- The `AskUserQuestion` runtime path was not captured (print mode skipped the
  tool); that matrix cell rests on official docs.
