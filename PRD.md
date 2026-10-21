# Agent Attention — Product Requirements Document

| Field | Value |
|---|---|
| **File** | `PRD.md` |
| **Product** | Agent Attention |
| **Document version** | 2.2 |
| **Last updated** | 2026-10-21 |
| **Status** | Proposed — MVP specification (source of truth) |
| **Product type** | Cross-agent plugin ecosystem |
| **Initial platform** | Windows 10/11 (native) |
| **Primary language** | TypeScript |
| **Architecture** | Agent-native adapters + shared notification core + local Notification Host (headless helper) |
| **Initial integration** | **OpenCode v2.0.32** (D-01, S1 scorecard; see §16.3) |
| **Target integrations** | Claude Code, OpenAI Codex, Gemini CLI, other compatible coding agents |

---

# 0. About This Document

## 0.1 Source-of-truth rules

This document is the authoritative specification for Agent Attention.

1. **This file wins.** If code, `docs/`, tickets, or chat history disagree with this document, the disagreement is a defect. Resolve it by updating this file or the code in the **same change**.
2. **Changes go through review.** Every change to this file updates the change log (§24) and, where applicable, the decision register (§23).
3. **Requirements are addressable.** Features use `F<n>`, requirements use `F<n>-R<m>`, acceptance criteria use `AC-F<n>-<mm>`, decisions use `D-<nn>`, spikes use `S<n>`, open questions use `Q-<nn>`. IDs are never reused.
4. **Normative language.** MUST / MUST NOT = mandatory. SHOULD / SHOULD NOT = expected unless a documented reason exists. MAY = optional.
5. **Status tags.** Statements about external systems (agent hosts, Windows behavior, libraries) carry one of:
   - **[Verified]** — confirmed against official documentation or a working experiment, with the reference recorded in `docs/`.
   - **[Assumption]** — believed true, not yet confirmed. Must be tied to a spike or open question.
   - **[Decided]** — an internal product or engineering decision (recorded in §23).
   - **[Proposed]** — recommended design pending validation by a named spike.
6. **No external fact is assumed to be true until tagged [Verified].** In this version, no host-agent API behavior has been verified. All host-specific statements are **[Assumption]**.

## 0.2 What changed from v1.0

v1.0 was strong on policy but under-specified feasibility. v2.0 adds: an explicit idle/turn-ended event, resume/resolution/session-end events, failure notifications, a resumable-session state machine with ordering and staleness rules, a decided process model (Notification Host with single-writer storage), Windows delivery spikes, WSL scope, injection/privacy hardening, focus awareness, rate limiting and audio queueing, reminders, a single source of truth for configuration, a CLI surface for preview/status/doctor, precision-oriented metrics, and a re-baselined schedule. Full list in §24.

---

# 1. Product Overview

## 1.1 Summary

Agent Attention is a cross-agent notification plugin ecosystem that helps developers stay aware of coding-agent activity without watching agent windows, terminals, or editor tabs.

Developers start long-running tasks in AI coding agents and move on to other work: reviewing tickets, reading documentation, attending meetings, inspecting logs, or working in another project. Meanwhile an agent may:

- Ask a question that blocks further execution.
- Request permission to run a command or perform an action.
- Stop and wait for the developer's next prompt.
- Finish a task or session successfully.
- Fail and stop progressing.

The developer often does not notice. Agent Attention provides native integrations that detect lifecycle events, translate them into a shared event contract, and notify the developer through configurable channels.

It is installed as a plugin or integration for existing coding agents. It MUST NOT require a standalone desktop application with its own primary interface.

## 1.2 Product vision

A consistent attention layer across coding agents, so developers can delegate work without repeatedly checking whether an agent is waiting, stopped, finished, or failed.

## 1.3 Core value proposition

**Know when your coding agent needs you, without constantly watching it.**

Agent Attention covers five principal moments:

1. The agent needs developer input.
2. The agent needs approval.
3. The agent has stopped and is waiting for the developer (turn ended; success not asserted).
4. The agent has verifiably completed a task or session.
5. The agent has failed.

Channels: configurable sounds, optional spoken announcements, Windows desktop notifications, and a local activity history queryable through a CLI and, where supported, host-native surfaces.

## 1.4 Positioning

Agent Attention is **not**: a coding agent, an AI model, an orchestration platform, a terminal emulator, a replacement for agent permission systems, or a standalone desktop monitoring application.

It is a notification and lifecycle-awareness layer integrated into existing coding agents.

## 1.5 Honest-signal principle

The most valuable real-world signal is often "the agent's turn ended and it is waiting for you." Many hosts cannot distinguish *finished*, *asked a question in plain text*, and *gave up*. Agent Attention therefore separates:

- **Classified events** (`needs_input`, `needs_approval`, `completed`, `failed`) — emitted only when the host provides a trustworthy signal.
- **Turn-ended event** (`turn_ended`) — an `inferred` event that says only "the agent stopped and is waiting for you." It never claims success.

This keeps the product useful on hosts with weak signals without falsely claiming completion.

---

# 2. Problem Statement

## 2.1 Current workflow

A developer starts a task:

> Implement the authentication flow, write tests, fix the failing tests, and update the documentation.

The developer switches to another window. Minutes later the agent asks whether to use cookie sessions or bearer tokens, and stops. The agent's window is in the background, so the question goes unnoticed. The developer returns much later, believing the task is still running. The same happens when the agent finishes, requests permission, or fails.

## 2.2 Root causes

- Agents expose lifecycle information through different mechanisms, with different reliability.
- Notifications are inconsistent between tools.
- Background tasks silently transition into blocked states.
- Completion and failure signals are not always surfaced.
- Developers lack one notification policy across multiple agents.

## 2.3 Consequences

- Time wasted while agents wait for answers or approvals.
- Repeated window switching to check progress.
- Completed or failed work goes unnoticed.
- Multiple agents become hard to supervise.
- Loss of confidence in unattended execution.

## 2.4 Proposed solution

One adapter per supported agent translates host-specific lifecycle signals into a shared event contract. A shared core applies preferences, deduplication, quiet hours, focus awareness, rate limiting, and event classification. A local Notification Host dispatches through sound, optional text-to-speech, and Windows desktop notifications, and records history.

---

# 3. Goals, Non-Goals, and Principles

## 3.1 Primary goals

1. Detect supported blocking input requests.
2. Detect approval and permission requests.
3. Detect verified task or session completion.
4. Notify when an agent stops and waits (turn ended) on hosts lacking richer signals.
5. Notify on failure.
6. Provide configurable event-specific sounds, volume, and mute.
7. Support optional spoken announcements.
8. Deliver Windows desktop notifications.
9. Maintain a multi-agent activity history, queryable via CLI and host-native surfaces where supported.
10. Reduce interruption through quiet hours, deduplication, focus awareness, coalescing, and rate limiting.
11. Reuse one event contract and one core across integrations.
12. Remain plugin-first, with no standalone application window.

## 3.2 Non-goals (MVP)

The MVP will not:

- Answer agent questions or approve/reject permissions automatically.
- Execute commands on behalf of the developer, or start, stop, modify, or prompt agent tasks.
- Provide remote task orchestration, or require an account or cloud backend.
- Upload source code, prompts, or conversation history.
- Provide team collaboration or shared histories.
- Guarantee support for every agent or execution environment.
- Interpret arbitrary terminal output as verified completion.
- Provide a graphical dashboard independent of the coding agents.
- Depend on an AI model to classify events.
- Support WSL, SSH, or dev-container-hosted agents (see §4.3 and D-09).
- Send remote or mobile push notifications (see §22 Future Directions).

## 3.3 Product principles

- **Plugin-first.** Users install integrations into agents they already use.
- **Shared core.** Notification logic is not reimplemented per adapter.
- **Reliable signals.** Classified events require trustworthy source signals; weaker signals use weaker event types.
- **Graceful degradation.** Unsupported or low-confidence capabilities are declared, not hidden.
- **Local-first.** No mandatory remote service.
- **Privacy-conscious.** Collect and display only what is necessary; no free-text content from agents in notifications.
- **Non-invasive.** Never alter prompts, permissions, or execution decisions, and never block or slow the host.
- **Low noise.** A missed alert is bad; alert fatigue is worse, because it leads users to disable the product.

---

# 4. Users and Environment

## 4.1 Primary persona — multi-agent developer

Uses two or more coding agents across terminals, editors, or repositories. Needs notifications without window switching, a consistent alert experience, independent sound/voice control, and clear identification of which agent and project needs attention.

## 4.2 Secondary persona — background-task developer

Launches long-running refactors, test runs, migrations, or implementations. Needs reliable end-of-work and failure alerts, early detection of blocked execution, and minimal interruption during ordinary progress.

## 4.3 Supported environment (MVP)

| Dimension | MVP scope |
|---|---|
| OS | Windows 10/11, **native** agent processes |
| Runtime | Node.js where required by the host integration (version range recorded after S1/S2) |
| Audio | Local Windows audio playback |
| Desktop notifications | Windows toast notifications |
| TTS | Local Windows-compatible TTS, no cloud |
| **Not supported** | Agents running inside WSL, SSH sessions, dev containers, or remote workspaces |

**WSL / remote [Decided, D-09]:** unsupported in MVP. The CLI `doctor` command MUST detect and report when an adapter runs in an unsupported environment, rather than failing silently. Post-MVP options are listed in §22.

Other operating systems may be supported later through platform adapters behind the provider interfaces.

---

# 5. Functional Scope

| ID | Feature | Priority |
|---|---|---|
| F1 | Detect when an agent needs input | P0 |
| F2 | Detect verified task or session completion | P0 |
| F3 | Detect approval requests | P0 |
| F4 | Configurable sounds, volume, and mute | P0 |
| F5 | Optional spoken announcements | P1 |
| F6 | Windows desktop notifications | P0 |
| F7 | Activity history and status (CLI + host-native surfaces) | P1 |
| F8 | Quiet hours and deduplication | P0 |
| F9 | Failure notification | P0 |
| F10 | Turn-ended (agent stopped and waiting) notification | P0 |
| F11 | Command-line interface (`status`, `history`, `preview`, `doctor`, `install`, `uninstall`, `mute`) | P0 |
| F12 | Alert hygiene: audio queue, coalescing, rate limiting | P0 |
| F13 | Focus awareness | P1 (gated by S3) |
| F14 | Reminders for unanswered input/approval | P1 |
| F15 | Privacy modes (discreet notifications) | P1 |

Priority indicates implementation importance, not whether an event is detectable in every agent. Each adapter declares what it supports (§16.2).

---

# 6. Feature Requirements and Acceptance Criteria

## 6.1 F1 — Detect when an agent needs input

**Description.** Detect a state in which the agent requires a developer response before it can continue (blocking clarification, choice between approaches, missing information).

**Requirements**

- **F1-R1** Each adapter MUST expose only the input-required signals its host supports, and declare their confidence.
- **F1-R2** The system MUST distinguish blocking questions from ordinary progress output.
- **F1-R3** Events MUST include agent identity and session identity; task and project when available.
- **F1-R4** Notifications MUST identify the source agent.
- **F1-R5** Repeated representations of the same request MUST NOT produce repeated alerts.
- **F1-R6** Inferred events MUST be distinguishable from authoritative events everywhere (contract, history, notification wording).
- **F1-R7** A question appearing in generated text MUST NOT be treated as blocking unless the host signals it authoritatively.
- **F1-R8** A valid `needs_input` event MUST move the session to `waiting_for_input` per §13.
- **F1-R9** An **inferred** `needs_input` MAY be enabled for an adapter only if it met the precision target in §19.3 on that adapter's fixtures. Otherwise the adapter MUST NOT emit it, and the user is served by `turn_ended` (F10).
- **F1-R10** A resume signal (`agent.resumed` with reason `input_provided`) MUST clear the waiting state and any pending request.

**Acceptance criteria**

- **AC-F1-01** Given an authoritative blocking-question signal, the adapter emits `agent.needs_input` with `confidence: authoritative`.
- **AC-F1-02** Given ordinary progress output, no input-required alert is generated.
- **AC-F1-03** Given duplicate signals for the same request, at most one audible alert occurs within the deduplication policy.
- **AC-F1-04** Given missing project metadata, the notification still identifies the agent and available session context.
- **AC-F1-05** Given a valid resume event, the session leaves `waiting_for_input` and the pending request is closed.
- **AC-F1-06** If the host cannot reliably distinguish blocking questions, the adapter's capability declaration lists `needs_input` as `unsupported` (or `inferred` with fixtures meeting F1-R9), and `agent-attention doctor` displays that support level.

---

## 6.2 F2 — Detect verified task or session completion

**Description.** Notify when a task or session reaches a verified successful terminal state.

**Requirements**

- **F2-R1** Completion MUST be based on an authoritative or explicitly validated source signal.
- **F2-R2** Task completion and session completion MUST be represented separately via `details.completionScope`.
- **F2-R3** Idle MUST NOT be treated as completion. Process exit MUST NOT imply successful completion.
- **F2-R4** A failure MUST NOT be converted into completion.
- **F2-R5** Completion events MUST identify scope, task (when scope is `task`), and session.
- **F2-R6** Duplicate completion events MUST be deduplicated.
- **F2-R7** The activity history MUST display completion distinctly from failure and from turn-ended.
- **F2-R8** Task completion MUST NOT force a multi-task session into `completed` while other work remains active.
- **F2-R9** Hosts with no task concept MUST NOT fabricate `taskId`. Such adapters declare `supportsTaskScope: false` and emit only session-scope completion, if the host authoritatively provides it.
- **F2-R10** Subagent completion MUST NOT be reported as parent-session completion (see §13.5).

**Acceptance criteria**

- **AC-F2-01** Given a verified task-completion signal, the adapter emits `agent.completed` with `completionScope: task`.
- **AC-F2-02** Given a verified session-completion signal, the adapter emits `agent.completed` with `completionScope: session`.
- **AC-F2-03** Given a process that becomes idle without a verified completion signal, no completion notification is generated (a `turn_ended` event MAY be generated per F10).
- **AC-F2-04** Given a verified failure, the session is not marked completed.
- **AC-F2-05** Given duplicate completion events for the same task, one completion notification is dispatched.
- **AC-F2-06** Given a task completing while others remain active, session-level state remains consistent with remaining work.
- **AC-F2-07** Given a subagent completion, the parent session's state and notifications are unaffected unless `notifySubagents` is enabled (§13.5).

---

## 6.3 F3 — Detect approval requests

**Description.** Detect when the agent requires explicit permission or confirmation for an operation (command execution, tool invocation, supported action).

**Requirements**

- **F3-R1** Approval requests MUST be represented by `agent.needs_approval`, distinct from `needs_input`.
- **F3-R2** Approval events MUST use a distinct default sound.
- **F3-R3** Events MUST identify source agent and session; SHOULD include a `requestId`.
- **F3-R4** Approval handling MUST remain entirely within the host's permission workflow. Agent Attention MUST NOT approve, reject, or execute anything.
- **F3-R5** Notifications MUST NOT expose command arguments, file paths, or tool payloads. Adapters MUST NOT forward them in events.
- **F3-R6** When the host signals resolution, the adapter MUST emit `agent.approval_resolved` with `resolution: approved | denied | unknown`; the pending request is closed.
- **F3-R7** A denial MUST be modeled (§13) and MUST NOT leave the session stuck in `waiting_for_approval`.

**Acceptance criteria**

- **AC-F3-01** Given a verified approval request, the adapter emits `agent.needs_approval`.
- **AC-F3-02** Approval uses a distinct default sound from completion.
- **AC-F3-03** The plugin never approves, rejects, or executes the requested operation.
- **AC-F3-04** Duplicate approval events are deduplicated; a new request with a new `requestId` in the same session is not.
- **AC-F3-05** Given `approval_resolved` (approved), the session returns to `working` and the pending request is closed.
- **AC-F3-06** Given `approval_resolved` (denied), the pending request is closed and the session does not remain in `waiting_for_approval`.
- **AC-F3-07** No event, log, notification, or history record contains command arguments or tool payloads.

---

## 6.4 F4 — Configurable sounds, volume, and mute

**Requirements**

- **F4-R1** Independent sound selection for: input required, approval required, turn ended, completed, failed.
- **F4-R2** Independent volume per event class.
- **F4-R3** Global mute and per-event sound enablement.
- **F4-R4** Built-in default sounds; sensible defaults MUST work with no setup.
- **F4-R5** Sound preview via CLI (`agent-attention preview <event>`), using the same sound and volume as real playback.
- **F4-R6** Preferences persist in `config.json` (§8). Global mute overrides all sound and voice playback.
- **F4-R7** Sound configuration is separate from voice configuration.
- **F4-R8** Overlap between simultaneous alerts is governed by F12.
- **F4-R9** Muting audio MUST NOT disable desktop notifications.
- **F4-R10** Audio-device unavailability or playback failure MUST NOT crash any component.
- **F4-R11** Custom sound files MAY be supported by path in config; if so, the file MUST be validated (extension allowlist, size limit, readable) and invalid files fall back to defaults with a diagnostic.

**Acceptance criteria**

- **AC-F4-01** Changing one event class's volume does not change another's.
- **AC-F4-02** Global mute prevents all notification sounds and voice.
- **AC-F4-03** Preview uses the selected sound and volume.
- **AC-F4-04** Sound settings persist across agent and Notification Host restarts.
- **AC-F4-05** Muting audio does not disable desktop notifications.
- **AC-F4-06** Playback failure does not crash the plugin, helper, or core, and is recorded in delivery history.

---

## 6.5 F5 — Optional spoken announcements

**Requirements**

- **F5-R1** Voice is disabled by default; each event class has independent voice enablement.
- **F5-R2** Announcements use controlled templates from §14.3 only.
- **F5-R3** Agent and project names are included only when available **and** pass the safe-name rules in §17.3.
- **F5-R4** Conversations, prompts, source code, and command output MUST NEVER be spoken.
- **F5-R5** Voice volume, voice selection, and rate are configurable independently of sound volume (`voice.*` in config).
- **F5-R6** Voice follows global mute, quiet hours, focus awareness, and F12 queueing.
- **F5-R7** TTS failure MUST NOT prevent event recording, sound, or desktop delivery.
- **F5-R8** Duplicate events MUST NOT trigger duplicate speech.
- **F5-R9** TTS MUST use a local Windows-compatible mechanism with no cloud dependency, and MUST receive text via a safe mechanism (§17.2), never string-interpolated into a command.

**Acceptance criteria**

- **AC-F5-01** With voice disabled, no speech is generated.
- **AC-F5-02** With voice enabled for an event class, a valid event produces the templated announcement.
- **AC-F5-03** TTS failure does not prevent desktop notification or state updates.
- **AC-F5-04** Duplicate events produce no duplicate speech.
- **AC-F5-05** Speech contains only the approved template and allowed metadata.
- **AC-F5-06** A project name containing characters outside the safe set (e.g., quotes, semicolons, control characters) is omitted from speech and does not alter the executed command.

---

## 6.6 F6 — Windows desktop notifications

**Required information:** agent name; project name (when available and permitted by privacy mode); event type; local-time timestamp; short templated description.

**Requirements**

- **F6-R1** Desktop notifications are enabled globally and per event class.
- **F6-R2** Content is concise, templated, and free of terminal output and sensitive payloads.
- **F6-R3** Timestamps use the user's local time.
- **F6-R4** Missing metadata is handled gracefully.
- **F6-R5** Events are persisted independently of toast delivery.
- **F6-R6** Failures MUST NOT crash any component.
- **F6-R7** Duplicate toasts MUST be avoided.
- **F6-R8** Quiet-hour desktop suppression is separately configurable.
- **F6-R9** The toast mechanism MUST work for an unpackaged, per-user installation. Required Windows registration (e.g., an application identity for toasts) MUST be created by `install`, verified by `doctor`, and removed by `uninstall`. **[Assumption]** — validate in S3.
- **F6-R10** `doctor` SHOULD report conditions known to suppress toasts (e.g., Focus Assist / Do Not Disturb) where detectable, and delivery records MUST NOT claim a toast was *seen*, only that it was *submitted*.
- **F6-R11** Click-to-focus (activating a toast to bring the related terminal/editor forward) is a P2 stretch goal, gated on S3. It MUST NOT send input to the agent.

**Acceptance criteria**

- **AC-F6-01** A valid event dispatches a toast when the channel is enabled and the mechanism is available.
- **AC-F6-02** The toast identifies agent and event type.
- **AC-F6-03** Project name appears when available and permitted.
- **AC-F6-04** Timestamp is in local time.
- **AC-F6-05** Toast failure does not prevent event persistence or other channels.
- **AC-F6-06** Disabling desktop notifications does not disable event collection.
- **AC-F6-07** `doctor` reports whether toast registration is present and valid.

---

## 6.7 F7 — Activity history and status

**Description.** A consistent view of session activity across installed integrations, **without a separate desktop dashboard**.

**Surface [Decided, D-07].** The MVP activity surface is the CLI (`agent-attention status`, `agent-attention history`). Where a host supports a native status or panel surface, an adapter MAY expose the same data there; this is optional and never blocks release.

**Required states:** `working`, `waiting_for_input`, `waiting_for_approval`, `idle`, `completed`, `failed`, `ended`, `unknown` (§13.1).

**Requirements**

- **F7-R1** Display agent name, project (when available), current state, **state confidence** (authoritative / inferred / unverified), last event time, and a shortened safe session identifier.
- **F7-R2** Support concurrent sessions from the same agent; events from one session MUST NOT affect another.
- **F7-R3** Restore session metadata after restart where available.
- **F7-R4** Sessions without recent verifiable activity MUST be shown as `unknown` after the stale timeout (§13.4).
- **F7-R5** Never invent task, project, or session metadata.
- **F7-R6** Task-level and session-level completion remain distinct.
- **F7-R7** `status` shows open pending requests (input/approval) and their age.
- **F7-R8** `history` supports filtering by agent, session, event type, and time range, and outputs human-readable text and JSON.
- **F7-R9** Subagent sessions are shown nested under their parent when the parent is known.

**Acceptance criteria**

- **AC-F7-01** Two concurrent sessions from the same agent remain separate.
- **AC-F7-02** An input-required event changes only the associated session's state.
- **AC-F7-03** Completed and failed sessions are visibly distinguishable.
- **AC-F7-04** A stale or unverified session is not shown as working.
- **AC-F7-05** `status` and `history` return correct results from a documented command.
- **AC-F7-06** If a host cannot expose a panel, notifications and shared history still work.
- **AC-F7-07** `status` lists open pending requests with age.

---

## 6.8 F8 — Quiet hours and deduplication

**Quiet-hours requirements**

- **F8-R1** Quiet hours can be enabled/disabled with start and end time in the local Windows timezone, including ranges crossing midnight.
- **F8-R2** Quiet hours suppress sound and voice independently configurable (`suppressSound`, `suppressVoice`) and desktop (`suppressDesktop`).
- **F8-R3** Event collection, state updates, and history continue during quiet hours.
- **F8-R4** Suppressed events MUST NOT be replayed as a burst when quiet hours end, and MUST NOT be silently discarded from history. Delivery records mark them `suppressed:quiet_hours`.
- **F8-R5** DST transitions: evaluation uses local wall-clock time at the moment of the event; a nonexistent or ambiguous local time MUST NOT cause an exception, and an interval is evaluated using wall-clock comparison only.
- **F8-R6** Pending-request reminders (F14) are also subject to quiet hours.

**Deduplication requirements** — algorithm in §14.4.

- **F8-R7** Prefer source-stable event identifiers; fall back to deterministic fingerprints.
- **F8-R8** Different sessions MUST NOT deduplicate against each other.
- **F8-R9** A new approval/input request in the same session MUST NOT be suppressed because of an earlier one.
- **F8-R10** Deduplication state MUST survive restarts.
- **F8-R11** Deduplication MUST be atomic for concurrent events (single writer, unique constraint).
- **F8-R12** Legitimate future events pass after the window or with a new request identity.

**Acceptance criteria**

- **AC-F8-01** During quiet hours, configured sound and voice are suppressed.
- **AC-F8-02** Events received during quiet hours remain in history.
- **AC-F8-03** Suppressed events are not replayed after quiet hours end.
- **AC-F8-04** Duplicate events produce no duplicate audible alerts.
- **AC-F8-05** Similar events from independent sessions are processed independently.
- **AC-F8-06** A new legitimate request in the same session is not suppressed by an unrelated earlier request.
- **AC-F8-07** A 23:00–08:00 range suppresses at 23:30 and 02:00 and not at 12:00; a configured range spanning a DST change does not throw.
- **AC-F8-08** Two events delivered concurrently with the same fingerprint produce exactly one dispatch.

---

## 6.9 F9 — Failure notification

**Description.** Notify when an agent session or task reaches a verified failure state.

- **F9-R1** `agent.failed` MUST be emitted only on an authoritative failure signal, or an inferred one that is labeled `inferred` and worded accordingly.
- **F9-R2** Failure MUST have its own sound, volume, voice, and desktop settings, and a distinct default sound.
- **F9-R3** `details.failureCode` is an enumerated, non-sensitive code (e.g., `host_error`, `cancelled`, `timeout`, `unknown`), never raw error text.
- **F9-R4** User-initiated cancellation SHOULD be distinguished (`cancelled`) and MAY be configured to not notify (default: no alert for `cancelled`).
- **F9-R5** Failure MUST NOT be reported as completion; completion MUST NOT overwrite failure.

**Acceptance criteria**

- **AC-F9-01** Given a verified failure, `agent.failed` is emitted and the session becomes `failed`.
- **AC-F9-02** Failure uses a different default sound than completion and approval.
- **AC-F9-03** `cancelled` does not alert by default.
- **AC-F9-04** No raw error text appears in notifications or history.

---

## 6.10 F10 — Turn-ended notification

**Description.** When the host reports only that the agent stopped working (idle, turn complete, stop), notify the developer that the agent is waiting for them, without claiming success.

- **F10-R1** `agent.turn_ended` is always `confidence: inferred` unless the host explicitly documents it as authoritative turn-boundary semantics. Its notification text MUST NOT claim success, completion, or a question.
- **F10-R2** Default wording: "<Agent> stopped and is waiting for you." [Decided, D-02]
- **F10-R3** If a classified event for the same turn (`needs_input`, `needs_approval`, `completed`, `failed`) arrives within the turn-end grace window (default 1000 ms, configurable), the core MUST suppress the `turn_ended` notification in favor of the classified one. Classified events always win.
- **F10-R4** The adapter MUST NOT emit both `turn_ended` and a classified event for the same signal when it can avoid it; the core guarantees no double alert regardless.
- **F10-R5** Turn-end alerts SHOULD be subject to a minimum turn duration (`minTurnSeconds`, default 15) so that short interactive exchanges do not alert. [Proposed — tune in dogfooding]
- **F10-R6** Subagent turn-ends MUST NOT notify unless `notifySubagents` is enabled.

**Acceptance criteria**

- **AC-F10-01** Given an idle signal without classification, one `turn_ended` alert is produced, worded without success claims.
- **AC-F10-02** Given an idle signal followed within the grace window by an authoritative `completed`, only the completion alert is produced.
- **AC-F10-03** Given a turn shorter than `minTurnSeconds`, no alert is produced and the event is recorded.
- **AC-F10-04** `turn_ended` never moves a session to `completed`; it moves it to `idle`.

---

## 6.11 F11 — Command-line interface

A CLI is a non-interactive command, not a desktop application. It has no window, tray icon, or persistent UI.

| Command | Purpose |
|---|---|
| `agent-attention status [--json]` | Current sessions, states, confidence, pending requests |
| `agent-attention history [filters] [--json]` | Event history |
| `agent-attention preview <event> [--voice]` | Play sound/voice/toast for an event class using real settings |
| `agent-attention doctor [--json]` | Environment and capability diagnostics (see below) |
| `agent-attention config path\|validate\|get\|set` | Configuration helpers |
| `agent-attention mute` / `unmute [--for <duration>]` | Quick global mute |
| `agent-attention install <host>` / `uninstall <host>` | Manage host integrations (§18.4) |

- **F11-R1** `doctor` MUST report: Windows version, Node version, Notification Host status, pipe reachability, DB health and schema version, config validity, audio device availability, TTS availability, toast registration, Focus Assist state when detectable, unsupported-environment detection (WSL/SSH/container), and per-adapter capability matrix with support levels.
- **F11-R2** All commands MUST exit non-zero on failure and offer `--json` for machine output.
- **F11-R3** The CLI MUST talk to the Notification Host via the same restricted interface as adapters and MUST NOT write the database directly while the host is running.

**Acceptance criteria**

- **AC-F11-01** `preview needsApproval` plays the configured approval sound at the configured volume.
- **AC-F11-02** `doctor` reports an unsupported environment when run under WSL.
- **AC-F11-03** `status --json` is valid JSON matching a documented schema.
- **AC-F11-04** `config validate` reports invalid values with the key path and the fallback applied.

---

## 6.12 F12 — Alert hygiene: audio queue, coalescing, rate limiting

- **F12-R1** Alerts MUST NOT play simultaneously. The Notification Host maintains a priority queue: `needs_approval` > `needs_input` > `failed` > `turn_ended` > `completed`. [Decided, D-10]
- **F12-R2** Queue length is bounded (`audio.maxQueueLength`, default 3); overflow drops the lowest-priority *audio* entry, never the history record or the desktop toast.
- **F12-R3** **Coalescing:** multiple eligible alerts within `coalesceWindowSeconds` (default 5) of the same event class MAY be merged into one alert ("3 agents need your attention") for sound/voice/desktop. History retains every event.
- **F12-R4** **Rate limiting:** no more than `maxAlertsPerMinute` (default 6) audible alerts per minute; excess alerts are recorded as `suppressed:rate_limit` and summarized in one coalesced alert.
- **F12-R5** Rate limiting and coalescing MUST NOT apply to the first `needs_approval` / `needs_input` alert for a new `requestId` after a quiet period.

**Acceptance criteria**

- **AC-F12-01** An approval in session A and a completion in session B arriving together do not overlap; approval plays first.
- **AC-F12-02** Ten events from ten sessions in one second produce at most `maxAlertsPerMinute` audible alerts and one summary, with all ten in history.
- **AC-F12-03** Queue overflow never drops a history record or a toast.

---

## 6.13 F13 — Focus awareness (P1, gated by S3)

- **F13-R1** When enabled, alerts for a session MUST be suppressed if the foreground window belongs to the same host terminal/editor that runs that session. Suppressed alerts are recorded as `suppressed:focused`.
- **F13-R2** If foreground-window detection is not reliable (S3 outcome), F13 ships disabled and is documented as unsupported rather than approximated.
- **F13-R3** **[Decided, D-11]** Focus suppression applies to all event classes by default; `needs_approval` MAY be configured to bypass focus suppression (`focus.bypassForApproval`, default `false`).
- **F13-R4** An "away" heuristic (no input for N minutes) MAY be added post-MVP.
- **F13-R5 [Decided, Q-06]** Ship F13 only for hosts that can supply a session
  window handle: Windows Terminal (`GetConsoleWindow()` → `GW_OWNER`) and
  classic console (`GetConsoleWindow()`). VS Code is **unsupported** because its
  extension API exposes no session→HWND mapping and PID-only matching produced
  false positives (two windows shared one PID). Focus suppression is
  window-scoped, not pane/tab-scoped; document that limit. `doctor` must report
  the per-host capability.

**Acceptance criteria**

- **AC-F13-01** With the host terminal focused, a `turn_ended` alert is suppressed and recorded.
- **AC-F13-02** With a different window focused, the alert plays.
- **AC-F13-03** If detection is unavailable, `doctor` reports focus awareness as unsupported and alerts are not suppressed.

---

## 6.14 F14 — Reminders (P1)

- **F14-R1** For an open `needs_input` or `needs_approval` request still unresolved after `reminders.afterMinutes`, the system MAY re-notify up to `reminders.maxReminders` times.
- **F14-R2** Reminders are **disabled by default** in the MVP [Decided, D-12; revisit after dogfooding], use distinct wording ("Still waiting"), and respect mute, quiet hours, focus, and F12.
- **F14-R3** A resolved or resumed request cancels pending reminders. Session end or staleness cancels reminders.
- **F14-R4** Reminders are recorded in history as reminders, not as duplicate original events.

**Acceptance criteria**

- **AC-F14-01** With reminders enabled and afterMinutes=10, an unresolved approval produces one reminder at ~10 minutes and none after resolution.
- **AC-F14-02** Reminders are suppressed during quiet hours.
- **AC-F14-03** With reminders disabled, none are produced.

---

## 6.15 F15 — Privacy modes (P1)

- **F15-R1** `privacy.mode: "standard"` shows agent and project name; `"discreet"` shows only generic text ("An agent needs attention") on toast and voice, suitable for screen-sharing.
- **F15-R2** `privacy.showProjectName` can independently hide project names in standard mode.
- **F15-R3** `agent-attention mute --for <duration>` and `privacy.mode` are quick-togglable via CLI.

**Acceptance criteria**

- **AC-F15-01** In discreet mode, no toast or speech contains a project or agent name.
- **AC-F15-02** History retains full local metadata regardless of mode.

---

# 7. User Experience

## 7.1 Installation experience

`agent-attention install <host>` MUST:

1. Register the integration using the host's documented mechanism (merge, never overwrite, host configuration; idempotent; timestamped backup of any file modified).
2. Create default configuration when none exists, without overwriting an existing one.
3. Register any Windows prerequisites (e.g., toast identity) [Assumption — S3].
4. Run `doctor` and print a concise result.
5. Require no account, cloud login, or standalone application.

`agent-attention uninstall <host>` MUST remove only what `install` added, restore or cleanly edit host configuration, leave user configuration and history intact by default, and offer `--purge` to remove them.

## 7.2 First-run behavior

Sensible defaults produce useful alerts with no setup: sound enabled, desktop enabled, voice disabled, quiet hours disabled, reminders disabled, focus awareness on if supported.

## 7.3 Configuration experience

Configuration lives in one file (§8) and is edited directly or through `agent-attention config`. Adapters may also expose host-specific settings only for capabilities that cannot be centralized.

---

# 8. Configuration (Single Source of Truth)

## 8.1 Rules

- **User preferences live only in `config.json`.** The database stores state and history, never preferences. [Decided, D-05]
- **Config path:** `%APPDATA%\AgentAttention\config.json`. **Data path (database, spool, logs):** `%LOCALAPPDATA%\AgentAttention\`. Config is roaming-friendly; machine-specific state is not. [Decided, D-05]
- The Notification Host reads config at start and on change (file watch with debounce). Adapters MUST NOT read or write it directly.
- Only the CLI and the user may write the file. Writes are atomic (temp file + rename) and preserve unknown keys. Adapters MUST NOT silently overwrite user settings.
- All values are validated against the schema. Invalid values fall back to defaults **per key**, and a diagnostic is recorded and shown by `doctor` and `config validate`.
- `schemaVersion` migrations are forward-only and back up the previous file.

## 8.2 Effective-policy resolution

An alert is delivered on a channel only if **all** are true:

```
global mute is off (sound & voice only)
AND channels.<channel> is true
AND events.<event>.enabled is true
AND events.<event>.<channel>.enabled is true
AND NOT suppressed by quiet hours for that channel
AND NOT suppressed by focus awareness
AND NOT suppressed by rate limiting / coalescing
```

Channel names: `sound`, `voice`, `desktop`. Global mute affects `sound` and `voice` only.

## 8.3 Schema (v2)

```json
{
  "schemaVersion": 2,
  "globalMute": false,
  "channels": { "sound": true, "voice": false, "desktop": true },

  "events": {
    "needsInput":    { "enabled": true, "sound": { "enabled": true, "soundId": "attention", "volume": 35 }, "voice": { "enabled": false }, "desktop": { "enabled": true } },
    "needsApproval": { "enabled": true, "sound": { "enabled": true, "soundId": "approval",  "volume": 45 }, "voice": { "enabled": false }, "desktop": { "enabled": true } },
    "turnEnded":     { "enabled": true, "sound": { "enabled": true, "soundId": "idle",      "volume": 25 }, "voice": { "enabled": false }, "desktop": { "enabled": true }, "minTurnSeconds": 15, "graceMs": 1000 },
    "completed":     { "enabled": true, "sound": { "enabled": true, "soundId": "complete",  "volume": 25 }, "voice": { "enabled": false }, "desktop": { "enabled": true } },
    "failed":        { "enabled": true, "sound": { "enabled": true, "soundId": "failure",   "volume": 40 }, "voice": { "enabled": false }, "desktop": { "enabled": true }, "notifyOnCancelled": false }
  },

  "voice": { "voiceId": null, "volume": 50, "rate": 0 },

  "quietHours": {
    "enabled": false,
    "startTime": "23:00",
    "endTime": "08:00",
    "suppressSound": true,
    "suppressVoice": true,
    "suppressDesktop": false
  },

  "focus": { "enabled": true, "bypassForApproval": false },

  "audio": { "maxQueueLength": 3 },
  "rateLimit": { "maxAlertsPerMinute": 6, "coalesceWindowSeconds": 5 },

  "reminders": { "enabled": false, "afterMinutes": 10, "maxReminders": 1 },

  "privacy": { "mode": "standard", "showProjectName": true },

  "subagents": { "notify": false },

  "deduplication": { "fallbackWindowSeconds": 30 },
  "stale": { "workingAfterMinutes": 15 },

  "activityHistory": { "enabled": true, "retentionDays": 7 }
}
```

Volumes are integers 0–100. Times are `HH:mm` 24-hour. Unknown `soundId` values fall back to the event default with a diagnostic.

---

# 9. Architecture

## 9.1 Principle

A shared core and a headless local Notification Host, with thin agent-specific adapters. The core owns normalization, state, deduplication, policy, and delivery. Adapters own host discovery and translation only.

## 9.2 Process model [Decided — D-03, S2]

Coding-agent hosts integrate in different ways: some load in-process plugins; others spawn a fresh command per lifecycle hook. A fresh process per event cannot hold state, cannot deduplicate atomically in memory, and pays startup cost each time. Therefore:

1. **Notification Host** — a headless, long-lived local process (no window, no tray icon). Started on demand by the first event from any adapter. It exits only when there is no connected client and no session has been seen within `session-live-ms`, then after `idle-ms` (default 600000); this avoids exiting between two events of a live session. It is the **single writer** for the database, owns providers, the audio queue, timers (reminders, stale detection, grace windows), and policy evaluation.
2. **Adapters** — either an in-process plugin (where the host supports it) or a **hook shim**: a minimal script that reads the host's hook payload, normalizes it, sends it to the Notification Host, and exits.
3. **Transport** — a per-user named pipe `\\.\pipe\agent-attention-u-<sid8>`, where `<sid8>` is a short hash of the account SID (not the mutable username). Exclusive pipe creation is the single-instance guard; a second host exits without taking over. No TCP listener. The default Node DACL grants `Everyone`/`Anonymous` read, so after `listen()` the host MUST apply the protected DACL `D:P(A;;FA;;;SY)(A;;FA;;;OW)` through koffi Win32 calls, read it back, and fail startup on any mismatch before announcing readiness. Until hardening completes, another user may observe the pipe (no write access was observed); that post-create window is a documented residual risk. PowerShell hardening is not used on the production path.
4. **Shim behavior (hard requirements):**
   - MUST NOT block the host: bounded total runtime (default ≤ 1000 ms), then exit.
   - MUST exit with a status that never alters host behavior (no blocking exit codes) unless a host explicitly requires otherwise and the spec is amended.
   - If the pipe is unreachable, spawn the Notification Host detached (hidden, no console window), then perform **one bounded retry phase** (fixed short poll, e.g. 40 ms, within the remaining budget), not a single immediate retry. If still unreachable, **spool** the event and exit.
   - Spool files are atomic per-event files under `%LOCALAPPDATA%\AgentAttention\spool\`; write to a temporary name, commit, then delete after acknowledgement. The host ingests the spool on start and deduplicates by `eventId`. File-name order is preserved; concurrent writes in the same millisecond have no total order, so the per-session `sequence` is authoritative.
   - MUST write nothing to the host's stdout/stderr that the host could interpret as instructions.
5. **CLI** uses the same pipe interface.

Because only the Notification Host opens SQLite, database and runtime-version problems are confined to one controlled process, not every adapter runtime. The built-in `node:sqlite` binding removes the native-module install path entirely. [Decided — D-04]

In-process embedding was not trialled and is not selected for the MVP. It remains a documented option for a single-host scenario, but the single-writer rule and the interface in §9.4 remain.

## 9.3 High-level architecture

```text
+--------------------------------------------------------------+
|                    Coding Agent Hosts                        |
|  OpenCode | Claude Code | Codex | Gemini CLI | Others        |
+---------+------------+--------+----------+-------------------+
          | in-process plugin  or  hook invocation (per event)
          v
+--------------------------------------------------------------+
|        Adapters (plugin or hook shim, TypeScript)            |
|  host signal -> normalized AgentEvent + capability metadata  |
+---------------------------+----------------------------------+
                            | named pipe (current user only)
                            |   (fallback: spool file)
                            v
+--------------------------------------------------------------+
|              Notification Host (headless, single writer)     |
|  +--------------------------------------------------------+  |
|  | Shared Core                                            |  |
|  |  validation - ordering - state machine - dedupe        |  |
|  |  policy - quiet hours - focus - rate/coalesce - timers |  |
|  +-----------------+--------------------+-----------------+  |
|                    |                    |                    |
|        +-----------v-----------+  +-----v-----------------+  |
|        | Providers (isolated)  |  | Local Store (SQLite)  |  |
|        | sound / voice / toast |  | sessions, events,     |  |
|        | + audio queue         |  | deliveries, dedupe,   |  |
|        +-----------------------+  | pending requests      |  |
|                                   +-----------------------+  |
+--------------------------------------------------------------+
            ^
            | same pipe
     agent-attention CLI (status, history, preview, doctor, ...)
```

## 9.4 Component responsibilities

### A. Adapters

Each adapter MUST:

- Use only documented, supported host mechanisms.
- Identify source agent, session, and (when available) subagent relationship.
- Emit normalized events with accurate `confidence`.
- Provide stable `eventId`s or a documented `dedupeKey` scheme (§14.4).
- Provide per-session monotonic `sequence` when the host allows.
- Declare capabilities (§16.2) and keep them accurate.
- Never block or slow the host; isolate its own failures.
- Document unsupported events.

### B. Shared core

Validates events; normalizes timestamps and metadata; orders events; maintains session/task/pending-request state; tracks task vs session completion; resolves effective policy; deduplicates; applies quiet hours, focus, rate limits, coalescing; schedules timers; dispatches via providers; records outcomes; produces diagnostics.

### C. Providers

Providers implement a common interface (`SoundProvider`, `SpeechProvider`, `DesktopProvider`) in `packages/notifications`; Windows implementations live in `packages/platform-windows`. Each provider MUST fail independently, report a structured result (`delivered | failed | unavailable`, `errorCode`), and never throw into the core. "Delivered" means *submitted to the OS*, not *seen by the user*.

### D. Local store

Persists sessions, events, deliveries, pending requests, deduplication records (§15). Accessed only by the Notification Host.

### E. Notification Host lifecycle

Start-on-demand, single-instance guarantee (named mutex or exclusive pipe creation), graceful shutdown on idle, crash-safe (atomic transactions; on restart, sessions without recent verifiable activity become `unknown` per §13.4), and bounded memory. It MUST NOT present UI.

---

# 10. Technology Stack

| Component | Technology | Status |
|---|---|---|
| Language | TypeScript | Decided |
| Runtime | Node.js 24 LTS; tested at **24.20.0**; require `>=24.20.0 <25` for built-in `node:sqlite`; per-host adapter runtime compatibility is declared separately | Decided (S1/S2) |
| Package manager / monorepo | **npm** with npm workspaces (`workspaces` field in root `package.json`); committed `package-lock.json`; `npm ci` in CI | Decided (D-18) |
| Dependency hygiene | Lint rule (e.g., `import/no-extraneous-dependencies`) or depcheck in CI to catch undeclared dependencies; each adapter, shim, and host bundled with tsup so shipped code is self-contained | Decided (D-18) |
| Internal versioning | Version ranges between workspace packages; Changesets MAY be adopted if keeping versions in sync becomes costly | Proposed |
| Schema validation | **Zod** for events and config; JSON Schema generated for docs/CLI `--json` | Decided (D-06) |
| Persistence | SQLite via built-in `node:sqlite` (`DatabaseSync`); single-writer in Notification Host; WAL; explicit transactions; busy timeout configured explicitly (default is 0). No native module, no postinstall build; requires Node ≥24.20.0 | Decided (D-04) |
| Configuration | JSON validated by Zod | Decided |
| IPC | Windows named pipe `\\.\pipe\agent-attention-u-<sid8>`; exclusive pipe creation is the single-instance guard; DACL hardened to SYSTEM + current user **before readiness** through koffi Win32 calls (no separate helper binary), and hardening failure is fatal; bounded retry polling then atomic per-event spool files | Decided (D-03) |
| Audio / TTS / toast | **Sound:** in-process `winmm` MCI via `koffi` primary; fixed PowerShell MCI/`SoundPlayer` fallback. **TTS:** fixed PowerShell `System.Speech` script, UTF-8 text via stdin, resident worker. **Toast:** per-user AUMID + Start Menu shortcut + WinRT `ToastNotificationManager`, fixed PowerShell sender, JSON via stdin, sanitized before XML. All local; no cloud; no event text on a command line | Decided (Q-05) |
| Unit tests | Vitest | Decided |
| Adapter tests | Recorded-event fixtures + mock host; small live smoke suite | Decided (D-08) |
| Build | tsup (or tsc) | Decided |
| Distribution | npm packages and host-native plugin packaging; see §18 | Proposed |

The shared core MUST NOT depend on any agent SDK. The core and providers MUST NOT depend on adapter packages.

---

# 11. Repository Structure

```text
agent-attention/
├── PRD.md
├── README.md
├── package.json            # declares npm "workspaces"
├── package-lock.json
├── tsconfig.base.json
├── packages/
│   ├── core/                 # events, ordering, state machine, dedupe, policy, timers (no I/O)
│   ├── contract/             # AgentEvent schema, capability types, version constants
│   ├── storage/              # SQLite schema, migrations, repositories (host-only use)
│   ├── notifications/        # provider INTERFACES, audio queue, templates, orchestration
│   ├── platform-windows/     # Windows IMPLEMENTATIONS of providers + foreground-window detection
│   ├── host/                 # Notification Host process (pipe server, lifecycle, spool ingest)
│   ├── shim/                 # shared hook-shim client (pipe client, spool fallback)
│   └── cli/                  # agent-attention command
├── adapters/
│   ├── opencode/
│   ├── claude-code/
│   ├── codex/
│   └── gemini-cli/
├── tests/
│   ├── fixtures/             # recorded host event streams per adapter
│   ├── unit/
│   ├── integration/
│   ├── acceptance/
│   └── live-smoke/           # small, manual/optional real-host checks
└── docs/
    ├── architecture.md
    ├── event-contract.md
    ├── adapter-development.md
    ├── host-signal-matrix.md   # S1 output, [Verified] references
    ├── installation.md
    └── troubleshooting.md
```

Ownership rule: `notifications` defines interfaces, queueing, and templates and has no OS calls; `platform-windows` is the only package with Windows-specific calls. The first prototype may use fewer packages, but these boundaries MUST remain.

---

# 12. Common Event Contract

## 12.1 Event types

| Event | Meaning |
|---|---|
| `agent.started` | Session (or turn) began |
| `agent.progress` | Ordinary activity (liveness); high volume; not persisted individually |
| `agent.needs_input` | Blocking developer input required |
| `agent.needs_approval` | Explicit permission required |
| `agent.approval_resolved` | An approval request was resolved (`approved` / `denied` / `unknown`) |
| `agent.resumed` | Work resumed (`input_provided` / `new_prompt` / `unknown`) |
| `agent.turn_ended` | Agent stopped and awaits the developer; no success or failure implied |
| `agent.completed` | Verified successful completion (`task` or `session` scope) |
| `agent.failed` | Verified failure |
| `agent.session_ended` | Session closed / process terminated (no outcome implied) |
| `agent.state_unknown` | Adapter cannot verify state |

These are internal names. Hosts may expose different names or not support every type.

## 12.2 TypeScript schema (v1 of the contract; event `schemaVersion: 1`)

```typescript
export type AgentEventType =
  | "agent.started"
  | "agent.progress"
  | "agent.needs_input"
  | "agent.needs_approval"
  | "agent.approval_resolved"
  | "agent.resumed"
  | "agent.turn_ended"
  | "agent.completed"
  | "agent.failed"
  | "agent.session_ended"
  | "agent.state_unknown";

export type EventConfidence = "authoritative" | "inferred";
export type CompletionScope = "task" | "session";
export type ApprovalResolution = "approved" | "denied" | "unknown";
export type ResumeReason = "input_provided" | "new_prompt" | "unknown";
export type FailureCode = "host_error" | "cancelled" | "timeout" | "unknown";
export type SummaryCode =
  | "INPUT_REQUIRED" | "APPROVAL_REQUIRED" | "TURN_ENDED"
  | "TASK_COMPLETED" | "SESSION_COMPLETED" | "FAILED" | "UNKNOWN";

export interface AgentEvent {
  schemaVersion: 1;

  eventId: string;            // unique within (adapterId, sessionId)
  eventIdStability: "source" | "synthetic";
  dedupeKey?: string;         // adapter-supplied stable key when eventId is synthetic
  sequence?: number;          // per-(adapterId, sessionId) monotonic, when the host allows

  eventType: AgentEventType;

  source: {
    adapterId: string;
    adapterVersion: string;
    agentId: string;
    agentName: string;
    agentVersion?: string;
  };

  session: {
    sessionId: string;
    parentSessionId?: string; // set for subagent sessions
    isSubagent?: boolean;
    taskId?: string;          // only if the host has a real task concept
    projectId?: string;
    projectName?: string;
    workingDirectory?: string;
  };

  occurredAt: string;         // ISO 8601 with timezone; source time when trustworthy
  receivedAt: string;         // ISO 8601 with timezone; set by receiver

  confidence: EventConfidence;

  details?: {
    summaryCode?: SummaryCode;          // enumerated; NO free text
    requestId?: string;
    completionScope?: CompletionScope;  // required for agent.completed
    resolution?: ApprovalResolution;    // required for agent.approval_resolved
    resumeReason?: ResumeReason;        // required for agent.resumed
    failureCode?: FailureCode;          // required for agent.failed
    turnDurationMs?: number;            // for agent.turn_ended, when known
  };
}
```

## 12.3 Schema rules

- **No free text from the agent.** The contract has no field for arbitrary summaries, messages, commands, or error text. Notification wording comes only from §14.3 templates.
- `eventId` identifies a source event within `(adapterId, sessionId)`. `eventIdStability: "source"` means the host supplies the ID; `"synthetic"` means the adapter generated it and MUST supply `dedupeKey` where a stable one is derivable.
- `sessionId` MUST remain stable for a known source session. A new session MUST get a new identity.
- `sequence`, when present, is strictly increasing per `(adapterId, sessionId)`.
- Timestamps are ISO 8601 with timezone. If `occurredAt` is untrustworthy, adapters omit trust by setting `occurredAt = receivedAt` and `eventIdStability` accordingly; the core MUST NOT rely on `occurredAt` for ordering when `sequence` is present.
- `authoritative` = the host provides a trustworthy signal for the declared semantics. `inferred` = weaker signal. Inferred completion MUST NOT be treated as verified success; in practice, adapters use `turn_ended` instead.
- Required `details` fields per event type (above) are enforced; violations reject the event.
- Unknown `schemaVersion` values and unknown `eventType`s are rejected safely and recorded in diagnostics (not in history).
- Optional fields stay absent rather than fabricated.
- Field length and charset limits (§17.3) apply at validation.

## 12.4 Example — input required

```json
{
  "schemaVersion": 1,
  "eventId": "event-1001",
  "eventIdStability": "source",
  "sequence": 14,
  "eventType": "agent.needs_input",
  "source": { "adapterId": "example-adapter", "adapterVersion": "1.0.0", "agentId": "example-agent", "agentName": "Example Agent" },
  "session": { "sessionId": "session-123", "projectName": "example-project" },
  "occurredAt": "2026-10-20T18:20:00Z",
  "receivedAt": "2026-10-20T18:20:01Z",
  "confidence": "authoritative",
  "details": { "summaryCode": "INPUT_REQUIRED", "requestId": "request-455" }
}
```

## 12.5 Example — approval required, then resolved

```json
{
  "schemaVersion": 1,
  "eventId": "event-1002",
  "eventIdStability": "source",
  "sequence": 15,
  "eventType": "agent.needs_approval",
  "source": { "adapterId": "example-adapter", "adapterVersion": "1.0.0", "agentId": "example-agent", "agentName": "Example Agent" },
  "session": { "sessionId": "session-123", "projectName": "example-project" },
  "occurredAt": "2026-10-20T18:21:00Z",
  "receivedAt": "2026-10-20T18:21:01Z",
  "confidence": "authoritative",
  "details": { "summaryCode": "APPROVAL_REQUIRED", "requestId": "request-456" }
}
```

```json
{
  "schemaVersion": 1,
  "eventId": "event-1003",
  "eventIdStability": "source",
  "sequence": 16,
  "eventType": "agent.approval_resolved",
  "source": { "adapterId": "example-adapter", "adapterVersion": "1.0.0", "agentId": "example-agent", "agentName": "Example Agent" },
  "session": { "sessionId": "session-123", "projectName": "example-project" },
  "occurredAt": "2026-10-20T18:22:10Z",
  "receivedAt": "2026-10-20T18:22:10Z",
  "confidence": "authoritative",
  "details": { "requestId": "request-456", "resolution": "approved" }
}
```

## 12.6 Example — turn ended (inferred)

```json
{
  "schemaVersion": 1,
  "eventId": "event-1004",
  "eventIdStability": "synthetic",
  "dedupeKey": "session-123:turn-7",
  "eventType": "agent.turn_ended",
  "source": { "adapterId": "example-adapter", "adapterVersion": "1.0.0", "agentId": "example-agent", "agentName": "Example Agent" },
  "session": { "sessionId": "session-123", "projectName": "example-project" },
  "occurredAt": "2026-10-20T18:25:00Z",
  "receivedAt": "2026-10-20T18:25:00Z",
  "confidence": "inferred",
  "details": { "summaryCode": "TURN_ENDED", "turnDurationMs": 312000 }
}
```

## 12.7 Example — task completion

```json
{
  "schemaVersion": 1,
  "eventId": "event-1005",
  "eventIdStability": "source",
  "eventType": "agent.completed",
  "source": { "adapterId": "example-adapter", "adapterVersion": "1.0.0", "agentId": "example-agent", "agentName": "Example Agent" },
  "session": { "sessionId": "session-123", "taskId": "task-789", "projectName": "example-project" },
  "occurredAt": "2026-10-20T18:26:00Z",
  "receivedAt": "2026-10-20T18:26:01Z",
  "confidence": "authoritative",
  "details": { "summaryCode": "TASK_COMPLETED", "completionScope": "task" }
}
```

These are examples of the internal format only. Production adapters MUST use real source identifiers and trustworthy timestamps.

---

# 13. Session State Machine

## 13.1 Normalized states

```typescript
export type SessionState =
  | "working"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "idle"        // turn ended; agent awaits next prompt; no outcome implied
  | "completed"   // verified success
  | "failed"      // verified failure
  | "ended"       // session closed / process terminated; no outcome implied
  | "unknown";
```

Each session also stores `stateConfidence`: `authoritative | inferred | unverified`, and `lastVerifiedAt`.

## 13.2 Transitions

| Current state | Event | Next state | Notes |
|---|---|---|---|
| (none) / unknown | `started` | working | Creates or revives session |
| (none) / unknown | any other event from an unseen session | state per event, `stateConfidence: inferred` | Late-joined session |
| working | `progress` | working | Updates `lastSeenAt` only |
| working | `needs_input` | waiting_for_input | Opens pending request |
| working | `needs_approval` | waiting_for_approval | Opens pending request |
| working | `turn_ended` | idle | |
| working | `completed` (session scope) | completed | |
| working | `completed` (task scope) | working or completed | Completed only if no active tasks remain **and** the host declares task tracking; else working |
| working | `failed` | failed | |
| waiting_for_input | `resumed` (input_provided) | working | Closes pending request |
| waiting_for_input | `progress` | working | Inferred resume; `stateConfidence: inferred` |
| waiting_for_input | `completed` / `failed` / `turn_ended` | completed / failed / idle | Closes pending request |
| waiting_for_approval | `approval_resolved` (approved) | working | Closes pending request |
| waiting_for_approval | `approval_resolved` (denied / unknown) | working | Closes pending request; next terminal event determines the outcome (§13.3) |
| waiting_for_approval | `completed` / `failed` / `turn_ended` | completed / failed / idle | Closes pending request |
| idle | `resumed` (new_prompt) / `started` / `progress` | working | New turn |
| completed | `resumed` (new_prompt) / `started` | working | **Terminal states are resumable** for conversational hosts |
| failed | `resumed` (new_prompt) / `started` | working | |
| any | `session_ended` | ended | Closes pending requests |
| any (non-ended) | no verifiable activity past stale timeout (§13.4) | unknown | `stateConfidence: unverified` |
| ended | any event with same `sessionId` | per event | Only if host reuses session IDs; otherwise rejected as a new-identity violation (logged) |

## 13.3 Rules

- Task completion MUST NOT imply session completion when other tasks remain active.
- A `denied` resolution closes the pending request. The session returns to `working` and is expected to be followed by `turn_ended`, `completed`, `failed`, or further activity. If no event follows, the stale timer applies.
- `completed` is never produced from `turn_ended`, `idle`, or `session_ended`.
- `failed` is never overwritten by a later `completed` for the same task/turn unless a `resumed`/`started` event intervenes.
- If event ordering is ambiguous, the core MUST preserve uncertainty (`stateConfidence: inferred` or `unknown`) rather than choose arbitrarily.

## 13.4 Ordering and staleness

**Ordering** (per `(adapterId, sessionId)`):

1. If `sequence` is present on both events, order by `sequence`.
2. Else if both have trustworthy `occurredAt`, order by `occurredAt`.
3. Else order by receipt order.

A state-changing event older than the session's last accepted state-changing event is **late**: it is recorded in history with `late: true`, does not change state, and does not notify, unless it closes a pending request that is still open (resolution events always close their request).

**Staleness:**

- A session in `working` with no event (including `progress`) for `stale.workingAfterMinutes` (default 15) becomes `unknown`.
- Sessions in `waiting_*` or `idle` do not go stale from silence alone (silence is expected), but are shown with age; they become `unknown` after `stale.waitingAfterHours` (default 12) [Proposed], and pending requests are closed with `resolution: unknown`.
- On Notification Host start, any session with no recent verifiable signal is set to `unknown`. The core MUST NOT assume a prior `working` state is still true after a host restart.
- Adapters SHOULD emit `progress` heartbeats where the host exposes activity; adapters that cannot MUST declare `supportsLiveness: false` so staleness for `working` is reported as lower confidence.

## 13.5 Tasks and subagents

- **Task:** a host-defined unit of work. Hosts without a task concept MUST NOT populate `taskId`. Task-scope completion requires `supportsTaskScope: true` in the capability declaration. [Decided, D-13]
- **Subagent:** a session with `isSubagent: true` and a `parentSessionId`. Subagent state is tracked separately and shown nested in `status`. Subagent `completed`, `turn_ended`, and `failed` do **not** notify and do **not** change the parent's state unless `subagents.notify` is enabled. Subagent `needs_input` and `needs_approval` **do** notify (they block progress), attributed to the parent project/agent. [Decided, D-14]
- Unknown parent: treat as an independent session.

---

# 14. Notification Policy, Templates, and Deduplication

## 14.1 Default event-to-channel mapping

| Event | Sound | Voice | Desktop | Notes |
|---|---|---|---|---|
| `needs_input` | Attention | Optional | Enabled | |
| `needs_approval` | Distinct approval | Optional | Enabled | Highest audio priority |
| `turn_ended` | Soft idle | Optional | Enabled | Inferred; min turn duration; grace window |
| `completed` | Soft completion | Optional | Enabled | Authoritative only |
| `failed` | Distinct failure | Optional | Enabled | `cancelled` does not alert by default |
| `approval_resolved`, `resumed`, `started`, `session_ended` | Disabled | Disabled | Disabled | State/history only |
| `progress`, `state_unknown` | Disabled | Disabled | Disabled | |

Users configure channels independently. Global mute overrides sound and voice.

## 14.2 Processing pipeline

For each received event, the Notification Host:

1. **Validate** schema, schema version, adapter identity, field limits. Reject safely on failure.
2. **Claim and persist (single transaction):** compute the fingerprint (§14.4), insert the dedupe record (unique constraint) and the event row. If the fingerprint already exists, record a duplicate counter and **stop** — duplicates MUST NOT mutate state, notify, or restart timers.
3. **Order check** (§13.4). Late events are recorded and stop here (except request-closing events).
4. **State transition** per §13.2; update pending requests; schedule/cancel timers (stale, grace, reminders).
5. **Resolve policy** (§8.2), including `notifySubagents`, `minTurnSeconds`, `notifyOnCancelled`.
6. **Apply suppressors** in order: quiet hours → focus awareness → turn-end grace/precedence → rate limit/coalesce. Each suppression is recorded with its reason.
7. **Dispatch** eligible channels through providers and the audio queue. Providers run independently.
8. **Record deliveries** per channel (`delivered | failed | unavailable | suppressed:<reason>`).

Persistence (step 2) MUST precede dispatch (step 7), so a failed notification never erases an event.

## 14.3 Notification templates

All user-visible and spoken text comes from a fixed, enumerated template set. Placeholders: `{agent}`, `{project}`, `{time}`.

| Event | Desktop title | Desktop body | Voice |
|---|---|---|---|
| `needs_input` | `{agent} needs your input` | `{project} · {time}` | "{agent} needs your input." |
| `needs_approval` | `{agent} needs approval` | `{project} · {time}` | "{agent} is waiting for approval." |
| `turn_ended` | `{agent} stopped and is waiting for you` | `{project} · {time}` | "{agent} stopped and is waiting for you." |
| `completed` (task) | `{agent} completed a task` | `{project} · {time}` | "{agent} completed a task." |
| `completed` (session) | `{agent} finished` | `{project} · {time}` | "{agent} has finished." |
| `failed` | `{agent} failed` | `{project} · {time}` | "{agent} failed." |
| reminder | `{agent} is still waiting` | `{project} · {time}` | "{agent} is still waiting for you." |
| coalesced | `{n} agents need your attention` | `{time}` | "{n} agents need your attention." |
| discreet mode | `An agent needs attention` | `{time}` | "An agent needs attention." |

If `{project}` is unavailable, hidden by privacy settings, or fails safe-name rules, it and its separator are omitted. `inferred` events MUST NOT use wording that implies certainty about outcome.

## 14.4 Deduplication algorithm

Fingerprint selection, in priority order:

1. **Source-stable ID:** if `eventIdStability == "source"`: `sha256(adapterId | sessionId | eventId)`.
2. **Adapter key:** if `dedupeKey` is present: `sha256(adapterId | sessionId | dedupeKey)`.
3. **Fallback composite:** `sha256(adapterId | sessionId | taskId? | eventType | requestId? | bucket)` where absent optional fields are encoded as an empty string with fixed delimiters (never omitted), and `bucket = floor(occurredAt / deduplication.fallbackWindowSeconds)`. Because bucket boundaries can split duplicates, the fallback check also tests the adjacent bucket.

Rules:

- The fallback window applies **only** to rule 3. Rules 1–2 are not time-windowed beyond record retention.
- Fingerprints never use only `sessionId + eventType`.
- A new `requestId` always yields a new fingerprint.
- Dedupe records persist for `max(fallbackWindowSeconds, 24h)` and survive restarts.
- Atomicity: single-writer plus a database unique constraint on `fingerprint`.
- Spooled events are deduplicated by the same rules on ingestion.
- `agent.progress` events are not fingerprinted or stored; they update `lastSeenAt` only.

## 14.5 Quiet hours, focus, and resumption behavior

- Quiet hours suppress configured channels but never stop processing or history.
- When quiet hours end, nothing is replayed. Only new eligible events notify.
- Latest session state remains accurate throughout.
- Focus suppression and quiet hours both record their own reason; if both apply, the first in pipeline order is recorded.

---

# 15. Persistence

SQLite, owned exclusively by the Notification Host. Migrations are versioned, forward-only, run in a transaction, and take a backup before applying. [Decided]

## 15.1 Tables

**`schema_migrations`** — `version`, `applied_at`.

**`agent_sessions`** — `session_id`, `adapter_id`, `agent_id`, `agent_name`, `agent_version`, `parent_session_id`, `is_subagent`, `project_id`, `project_name`, `working_directory`, `state`, `state_confidence`, `last_event_at`, `last_seen_at`, `last_verified_at`, `last_accepted_sequence` (highest sequence accepted for out-of-order detection), `created_at`, `updated_at`. Primary key: `(adapter_id, session_id)`.

**`agent_tasks`** *(only for adapters with `supportsTaskScope`)* — `adapter_id`, `session_id`, `task_id`, `state`, `started_at`, `ended_at`.

**`agent_events`** — `id`, `event_id`, `adapter_id`, `session_id`, `task_id`, `event_type`, `summary_code`, `request_id`, `sequence`, `ingest_seq`, `occurred_at`, `received_at`, `confidence`, `late`, `fingerprint`, `processed_at`, `details_json` (enumerated fields only).

**`event_deliveries`** — `event_id`, `channel` (`sound | voice | desktop`), `status` (`delivered | failed | unavailable | suppressed`), `reason` (e.g., `quiet_hours`, `focused`, `rate_limit`, `muted`, `coalesced`, `grace_superseded`, `below_min_turn`), `error_code`, `attempted_at`.

**`pending_requests`** — `adapter_id`, `session_id`, `request_id`, `kind` (`input | approval`), `opened_at`, `resolved_at`, `resolution`, `reminders_sent`.

**`dedupe_records`** — `fingerprint` (PRIMARY KEY), `event_id`, `first_seen_at`, `expires_at`, `duplicate_count`.

There is **no preferences table**. Preferences live only in `config.json` (D-05).

## 15.2 Retention and privacy

- `activityHistory.retentionDays` (default 7) applies to events, deliveries, and ended/stale sessions; a periodic purge runs in the Notification Host.
- `agent.progress` is never persisted as an event row.
- No conversations, prompts, source files, command arguments, tool payloads, error text, secrets, tokens, or environment variables are stored.
- `working_directory` is stored locally for disambiguation but is never displayed in full by notifications; only the final path segment may be shown (subject to safe-name rules).
- Logs follow the same rules and are size-capped with rotation.

---

# 16. Adapter Strategy

## 16.1 Host selection scorecard (Milestone 0 / S1)

The first integration is **chosen by evidence, not convenience**. For each candidate host (at minimum: OpenCode, Claude Code, and one other), S1 produces a row in `docs/host-signal-matrix.md` with **[Verified]** references:

| Criterion | Question |
|---|---|
| Approval signal | Is there an authoritative, documented permission-request signal? |
| Resolution signal | Is approve/deny resolution observable? |
| Blocking input | Is a blocking question distinguishable from plain text? |
| Turn boundary | Is there a documented stop/idle/turn-end signal? |
| Completion | Is verified task or session completion exposed? |
| Failure | Is failure/error distinguishable from cancel? |
| Stable IDs / sequence | Are session and event IDs stable? Is ordering available? |
| Subagents | Are subagent sessions identifiable? |
| Non-blocking | Can the integration run without delaying the host? |
| Windows-native | Does it run natively on Windows? |
| Stability | Is the API documented and versioned? |

Selection rule: choose the host with the highest count of authoritative signals among {approval, resolution, turn boundary, completion, failure}, using integration convenience only as a tie-breaker. The choice and scorecard are recorded in D-01.

## 16.2 Adapter contract and capability declaration

```typescript
export type SupportLevel = "authoritative" | "inferred" | "unsupported";

export interface AdapterCapabilities {
  adapterId: string;
  adapterVersion: string;
  hostVersionRange?: string;
  executionModel: "in_process_plugin" | "hook_process" | "extension";

  events: Record<AgentEventType, {
    support: SupportLevel;
    sourceSignal?: string;     // documented host event/hook name
    verifiedAgainst?: string;  // host version + date of S1 verification
    notes?: string;
  }>;

  eventIdsStable: boolean;
  supportsSequence: boolean;
  supportsTaskScope: boolean;
  supportsSubagents: boolean;
  supportsLiveness: boolean;    // can emit progress heartbeats
  supportsResolutionSignals: boolean;
}

export interface AgentAttentionAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getCapabilities(): AdapterCapabilities;
}
```

- The capability declaration is the **only** place support is claimed. `doctor`, documentation, and metrics read from it.
- An adapter MUST NOT emit an event type it declares `unsupported`; the core rejects such events.
- An event declared `inferred` MUST be emitted with `confidence: "inferred"`.
- The interface standardizes lifecycle and capabilities; it does not force incompatible host APIs into one implementation.

## 16.3 OpenCode adapter

**[Decided, D-01]** First integration. S1 verified the v2.0.32 TypeScript/JavaScript
plugin mechanism and permission lifecycle at runtime. Goals:

- Register through the documented plugin system.
- Subscribe to `permission.asked`, `permission.replied`, and
  `session.execution.started|succeeded|failed|interrupted`; normalize them.
- Emit authoritative `needs_approval` and `approval_resolved` events from
  `permission.asked` / `permission.replied`.
- Do **not** wait for the documented `session.idle` event: it did not fire in
  v2.0.32 (0/260). Use the `session.execution.*` terminal events; bind
  `succeeded`/`failed` to the durable idle message outcome before emitting a
  classified event. An idle signal is never used as completion by itself.
- Treat `session.execution.interrupted` with `reason:"shutdown"` after a denied
  permission as cancellation, not failure.
- Blocking input is distinguishable for typed permission requests; the
  dedicated question tool was not exercised at runtime, so keep that mapping
  behind a capability flag until re-probed.
- Validate against the frozen fixtures under `tests/fixtures/opencode/`.

## 16.4 Claude Code adapter

**[Verified, S1]** The host exposes documented hooks for permission, turn-end,
failure, and session-end moments. Goals: use documented hooks only; map
`PermissionRequest` to `needs_approval`; there is **no resolution event**, so
`approval_resolved` is inferred from `PostToolUse` (execution) or its absence
and must stay `inferred`; map `Stop` to `turn_ended` (not completion) and
`StopFailure` / `PostToolUseFailure` to failure. On 2.1.181, `PermissionRequest`
fires in the interactive TUI but not in headless `-p`, which auto-denies; record
that as a capability gap. Command hooks block by default; use `async: true`
where the decision does not need to block. The hook shim must satisfy §9.2
non-blocking rules.

## 16.5 Codex adapter

**[Verified, S1]** Codex CLI 0.155.1 has a documented, Windows-native hooks
framework (`PermissionRequest`, `Stop`, `SessionEnd`, `SubagentStart/Stop`,
`Interrupt`), but S1 could not capture the approval hook at runtime because the
probe was untrusted and `codex exec` blocks by policy. No resolution,
completion, or failure hook was found. Treat approval as documentation-only
until a trusted interactive probe runs; use `Stop` for `turn_ended`; document
the missing resolution/completion/failure signals in the capability
declaration.

## 16.6 Gemini CLI adapter

**Not evaluated in S1.** Codex was chosen as the third host because it exposed a
stronger permission hook. Gemini CLI 0.42.0 documents hooks, but its
`Notification` hook is observability-only and cannot decide a permission, and
its docs expose no approval-resolution or failure hook. Re-evaluate if Gemini
becomes a target host; do not claim its cells from the Codex evidence.

## 16.7 Reuse rule

The first integration establishes the contract and test suite. Additional adapters MUST reuse the core and MUST NOT reimplement deduplication, preferences, quiet hours, fingerprints, state transitions, or templates. Host-specific behavior stays inside the adapter.

---

# 17. Security and Privacy

## 17.1 Permissions and trust boundaries

- Use the least-privileged supported integration mechanism; do not request broad filesystem or network access without a documented need.
- Never bypass or alter agent permission controls.
- Never execute commands taken from event payloads.
- **Threat model:** other processes running as the same user can reach the named pipe and could spoof events. This is an **accepted limitation** for the MVP (same-user trust boundary), mitigated by the current-user-only ACL, payload validation, rate limiting, and by the fact that spoofed events can only cause alerts, never actions. Cross-user access MUST be denied. [Decided, D-15]
- An adapter MUST NOT overwrite another adapter's session state: sessions are keyed by `(adapterId, sessionId)`, and the Notification Host rejects events whose `adapterId` conflicts with the connection's registered identity where the transport allows verification.

## 17.2 Safe invocation (injection prevention)

Project names, directory names, and agent names are attacker-influenceable strings (a repository folder can be named anything). Therefore:

- Provider implementations MUST NOT build shell, PowerShell, or XML/toast markup by string interpolation of event-derived values.
- Event-derived text MUST be passed through structured parameters (stdin, arguments array without a shell, or a native API), or be escaped by a tested, centralized escaper for the specific target (toast XML, SSML-like TTS markup, etc.).
- Windows PowerShell, if used, MUST be invoked with fixed scripts and parameters passed as data, never concatenated into command text.
- Test fixtures MUST include hostile names (quotes, semicolons, backticks, `$()`, `%VAR%`, XML/markup characters, very long strings, Unicode controls, right-to-left overrides) and verify no behavioral change.

## 17.3 Safe-name rules

Applied at validation and again at presentation:

- Strip control characters and bidirectional override characters.
- Maximum 64 characters; truncate with an ellipsis for desktop display.
- Voice uses a name only if it matches an allowlist of letters, digits, space, `.`, `_`, `-` (Unicode letters allowed); otherwise the name is omitted from speech.
- Display uses the final path segment of `workingDirectory` when `projectName` is absent.
- Session IDs are displayed only as a short hash-like prefix.

## 17.4 Data privacy

- No upload of prompts, source code, or conversations; no account or cloud service; no telemetry in the MVP.
- No command arguments or tool payloads in events, notifications, history, or logs.
- Controlled templates only (§14.3). Discreet mode available (F15).
- Logs exclude credentials and unrestricted terminal output.

## 17.5 Failure isolation

- An adapter failure MUST NOT crash the Notification Host or core.
- A provider failure MUST NOT block other providers or event recording.
- Invalid events are rejected safely and counted in diagnostics.
- A shim failure or missing Notification Host MUST NOT affect the host agent (spool fallback, bounded runtime).
- Shutdown releases resources (pipe, timers, handles) and stops background work.

---

# 18. Installation, Packaging, and Distribution

## 18.1 Distribution

npm packages for the core, host, shim, and CLI; host-native plugin packaging for each adapter as the host requires; documented local installation as a fallback. The exact packaging is finalized after S1/S2. [Proposed]

## 18.2 Versioning and compatibility

- Semantic versioning per package; the event contract carries its own `schemaVersion`.
- Adapters declare `hostVersionRange` and are tested per range.
- A compatibility matrix (host version × adapter version × OS version × Node version) ships with every release.
- The Notification Host accepts events from adapters whose contract version it supports and reports a clear diagnostic otherwise.

## 18.3 Host-compatibility change control

Host APIs may change. Each adapter has contract tests built from recorded fixtures; a host upgrade that breaks fixtures downgrades the adapter's capability declaration until re-verified.

## 18.4 Install and uninstall mechanics

- Edits to host configuration use merge semantics, are idempotent, and take a timestamped backup.
- Re-running `install` makes no changes if already installed correctly.
- `uninstall` removes only what `install` added and restores or cleanly edits host configuration.
- `uninstall` stops the Notification Host if no other adapter is installed, and removes Windows registrations created by `install`.
- `install` and `uninstall` MUST NOT require administrator rights. If a step would, it is a defect or a documented exception to be approved here.

---

# 19. Testing Strategy and Success Metrics

## 19.1 Testing strategy

**Unit tests (Vitest)** — schema validation (including rejection of unknown versions and missing required `details`); normalization; ordering (sequence, timestamps, receipt order, late events); state transitions including resumable terminal states and denial; task vs session completion; subagent handling; fingerprints (all three rules, null handling, adjacent buckets); quiet hours (cross-midnight, DST, boundaries); global mute; effective-policy resolution; volume independence; templates and privacy modes; safe-name rules; staleness; turn-end grace and min duration; rate limit, coalescing, queue priority; reminders; config validation and per-key fallback.

**Adapter tests** — primarily **recorded-event fixtures** replayed through the adapter and core (deterministic, free, CI-friendly), plus a **mock host** where feasible. A small **live smoke suite** (`tests/live-smoke`) runs against real host sessions manually or on a schedule; it is not a CI gate. Each adapter covers: session start; ordinary progress; blocking input (if supported); approval and its resolution (approved and denied); turn end; verified task completion; verified session completion; failure and cancellation; duplicate delivery; concurrent sessions; subagents; process termination; plugin/host restart; missing metadata; unsupported lifecycle events.

Tests record, per event, whether it was detected and whether its classification was authoritative or inferred.

**Notification tests** — sound selection and volume; mute; preview; voice; toast; quiet-hour suppression; deduplication; audio-device failure; TTS failure; toast failure; hostile-name injection tests (§17.2); Focus Assist behavior (manual).

**Concurrency and resilience tests** — concurrent identical events yield one dispatch; Notification Host crash and restart; spool ingestion order; pipe unavailable; Notification Host double-start (single instance).

**Performance tests** — shim overhead, receipt-to-dispatch latency under burst (e.g., 50 events/second).

## 19.2 Acceptance scenarios

- **A — Blocking question.** An authoritative input event records `waiting_for_input` and invokes configured channels.
- **B — Ordinary progress.** No alert is generated.
- **C — Approval.** The approval-specific alert plays; the operation is not approved or executed; resolution closes the request.
- **D — Completion.** A verified task-completion event records task-level completion and one notification.
- **E — Concurrent agents.** Three active sessions; one session's event does not alter another's state.
- **F — Quiet hours.** Alerts are suppressed; the event remains in history; nothing replays afterward.
- **G — Duplicates.** The same event delivered repeatedly yields one audible alert.
- **H — Notification failure.** Toast failure leaves the event recorded and other channels working.
- **I — Uncertain state.** An unverifiable session is recorded as `unknown`.
- **J — Idle only.** A host that only reports idle yields `turn_ended` with non-success wording, never `completed`.
- **K — Classified beats idle.** An idle event and a `needs_approval` within the grace window yield only the approval alert.
- **L — Failure.** A failure yields a failure alert and `failed` state; a later new prompt resumes the session.
- **M — Denial.** A denied approval closes the request; the session does not stay in `waiting_for_approval`.
- **N — Storm.** Many simultaneous events produce no overlapping audio, bounded alert count, one summary, and complete history.
- **O — Hostile project name.** A project named with shell/markup metacharacters produces a safe notification and no injected behavior.
- **P — Restart.** After a Notification Host restart, previously `working` sessions become `unknown` and recent duplicates are still suppressed.
- **Q — Unsupported environment.** `doctor` reports WSL/SSH/container usage.

## 19.3 Success metrics

Targets are **proposed validation targets, not measured results**. Metrics are measured **per adapter and per event class**, against **both** recorded fixtures and live smoke runs. Unsupported or `unsupported`-declared events are excluded from recall denominators and MUST NOT be counted as supported because the core can process synthetic events.

| Metric | Target | Method |
|---|---|---|
| Recall — authoritative `needs_approval` | ≥ 95% | Live smoke + fixtures |
| Recall — authoritative `needs_input` (if supported) | ≥ 95% | Live smoke + fixtures |
| Recall — verified `completed` / `failed` | ≥ 99% | Live smoke + fixtures |
| **Precision — false alerts** (alerts for non-qualifying signals) for `needs_input`, `needs_approval`, `completed`, `failed` | ≤ 2% of alerts | Fixtures including adversarial ordinary-text cases |
| **Precision — inferred `needs_input`** (allowed only if met) | ≤ 5% false alerts | Fixtures |
| `turn_ended` — spurious alerts (e.g., sub-`minTurnSeconds`, subagent, superseded) | 0 in deterministic fixtures | Fixtures |
| Duplicate audible alerts for the same event | 0 | Deterministic dedupe tests |
| Receipt-to-dispatch latency (Notification Host) | p95 < 500 ms | Perf tests [Proposed; validate in S2] |
| Hook shim overhead on host | p95 < 300 ms; hard cap 1000 ms | Perf tests [Proposed; validate in S2] |
| Hook-to-audible-sound end-to-end | p95 < 2 s | Perf tests |
| Quiet-hour suppression | 100% | Deterministic tests |
| Session attribution | 100% on deterministic fixtures | Fixtures |
| Event-contract compatibility | All adapters pass shared contract tests | CI |
| Notification Host crash-free | No crash across the full fixture and storm suites | CI |

**Outcome signals (dogfooding, local-first, no telemetry):** during the Milestone 4 and 5 dogfood period, the team records (self-reported or via an opt-in local `agent-attention history --json` export): alerts per day, alerts judged unhelpful, channels the user disabled within the first week, and missed events noticed. Target: no event class judged unhelpful by more than 20% of alerts, and no channel disabled for noise by the dogfood users. [Proposed]

---

# 20. Implementation Milestones

Planning assumes one developer, a Windows development environment, and access to the necessary agent integrations. Estimates are planning assumptions (not measurements) and MUST be re-baselined at the end of Milestone 0.

## Milestone 0 — Feasibility spikes (time-boxed)

**Estimate:** 5–7 working days. Three parallel-able spikes:

**Outcome (2026-10-20): complete.** The evidence was gathered in one parallel
session, but the original 5–7 day estimate is retained for single-developer
planning. D-01/D-03/D-04 are decided; Q-05/Q-06/Q-07 are answered; Q-07
(click-to-focus) is deferred; the matrix and OpenCode fixtures are written. The
remaining validation limits are recorded in `docs/phase-0.md` §3.

- **S1 — Host signals.** For OpenCode, Claude Code, and one additional host: verify against official documentation and a working experiment which of the §16.1 criteria are met. Produce `docs/host-signal-matrix.md` with [Verified] references and the fixtures for the chosen host. Decide D-01 (first host).
- **S2 — Process model and storage.** Prototype the Notification Host + shim + named pipe + spool; measure shim overhead and receipt-to-dispatch latency; choose the SQLite binding; verify single-instance behavior and idle exit. Decide D-03/D-04 and ratify or amend §9.2.
- **S3 — Windows delivery.** Prototype sound, TTS, and toast from the Notification Host as an unpackaged per-user install: toast identity registration, startup latency, AV/EDR behavior, Focus Assist behavior, foreground-window detection (F13), and click-to-focus feasibility (F6-R11). Decide Q-05 and F13 viability.

**Exit criteria:** the decision register is updated; each spike has a written result; at least one host has a validated route to approval detection and a documented position on input, turn-end, completion, and failure; the schedule is re-baselined. **Spike code is throwaway** and MUST NOT be promoted to production without rewrite against §12–§14.

## Milestone 1 — Contract, core, and fixtures

**Estimate:** 5–7 working days. Contract package; Zod schemas; ordering; state machine; fingerprints and dedupe; policy resolution; templates; safe-name rules; config schema and validation; timers abstraction; unit test suite; fixture format.
**Exit:** all §19.1 unit areas pass; synthetic and recorded fixture streams yield correct states without duplicate processing.

## Milestone 2 — Notification Host and providers

**Estimate:** 6–8 working days (re-baselined +1 day for the production ACL path and resident provider workers). Host process, pipe server, single-instance, spool ingest, SQLite store and migrations, providers (sound, voice, toast) with safe invocation, audio queue, delivery records, `doctor` basics.
**Exit:** providers fail independently; hostile-name tests pass; crash/restart tests pass.

**Outcome (2026-10-21): complete.** The host, SQLite store, shim, spool, audio queue, Windows providers, and doctor/latency path are implemented. The full gate is green; the real `dist/main.js` path was exercised end to end (`shim -> pipe -> SQLite -> dispatch`), including a protected DACL, a persisted session, a delivered sound, and independent toast unavailability. Provider failures remain isolated, hostile-name tests pass, and crash/restart/single-instance tests pass. Latency is within the target (receipt-to-dispatch p95 < 5 ms in the smoke run; receipt-to-response p95 40.7 ms). The TTS resident-worker optimization remains a recorded Phase 6 follow-up (per-utterance cold path measured at 4.8 s); it is off the IPC path and does not affect event persistence or other channels. Evidence is in [`docs/phase-2.md`](docs/phase-2.md).

## Milestone 3 — First adapter

**Estimate:** 4–6 working days. Adapter for the host chosen in D-01; capability declaration; fixtures recorded from real sessions; install/uninstall; live smoke tests.
**Exit:** the adapter loads reliably and detects its declared events in documented scenarios; the capability declaration matches measured behavior.

## Milestone 4 — Attention policy, CLI, and history

**Estimate:** 5–7 working days. Quiet hours (incl. DST); rate limiting and coalescing; turn-end grace and min duration; subagent policy; focus awareness for WT/classic console only (Q-06; VS Code unsupported; click-to-focus task deferred); reminders; privacy modes; `status`, `history`, `preview`, `mute`, `config`, full `doctor`; retention purge; start of dogfooding.
**Exit:** F4–F15 acceptance criteria pass for the supported capabilities.

## Milestone 5 — Second adapter

**Estimate:** 4–6 working days. Second adapter, shared contract tests, capability reporting, installation and troubleshooting docs.
**Exit:** the second adapter reuses the core without core changes beyond contract-level fixes, and passes its supported-event tests.

## Milestone 6 — Hardening and release

**Estimate:** 4–5 working days. Security review against §17; install/uninstall verification on clean Windows profiles (no admin); packaging; compatibility matrix; test report; documentation; dogfood findings applied.
**Exit:** users can install and configure supported plugins without a standalone desktop application.

## Overall estimate

Approximately **33–46 working days** for an initial release with two integrations, subject to the reliability of host APIs and the S1–S3 outcomes. This is the re-baselined total: M2 grew by one day for the ACL path and resident provider workers; the other milestone estimates are unchanged. Phases 0–2 are complete, leaving approximately **17–24 working days** for M3–M6. v1.0's 17–26 day estimate did not include process-model and Windows-delivery feasibility, hardening, install/uninstall logic, or dogfooding.

---

# 21. Definition of Done and Risks

## 21.1 Definition of Done

The MVP is ready for initial release when:

- At least two agent integrations are implemented and validated, each with an accurate capability declaration.
- The shared contract, state machine, ordering, and staleness rules are implemented and tested.
- Blocking input, approval, turn-ended, completion, and failure are distinct events with distinct handling.
- Completion is based only on verified source signals; idle never produces completion.
- Sound, voice, and desktop channels work, with independent settings and independent failure.
- Multiple concurrent sessions and subagents remain correctly separated.
- Quiet hours, deduplication, audio queueing, coalescing, and rate limiting behave per spec.
- Configuration lives solely in `config.json`; history and state persist locally.
- The CLI provides `status`, `history`, `preview`, `doctor`, `config`, `mute`, `install`, `uninstall`.
- Adapter, shim, and provider failures never crash the Notification Host or affect the host agent.
- Security and privacy requirements (§17), including injection tests, are satisfied.
- Installation and troubleshooting documentation is complete; `install`/`uninstall` need no admin rights and are idempotent.
- Metrics in §19.3 meet targets or documented, approved exceptions per adapter.
- No standalone desktop application is required.

## 21.2 Technical risks and mitigations

| Risk | Mitigation |
|---|---|
| Host exposes no blocking-question or completion signal | `turn_ended` as the honest fallback; document limits; capability declaration shows support level |
| Idle signal mistaken for completion | `turn_ended` is a distinct, inferred event; completion requires an authoritative signal |
| Alert fatigue leads users to disable the product | Precision targets, `minTurnSeconds`, focus awareness, coalescing, rate limits, dogfood outcome signals |
| Host APIs change | Versioned adapters, fixture contract tests, capability downgrade on break |
| Hook processes are short-lived; no shared state | Notification Host + shim + spool (§9.2) |
| Hook delays or breaks the host | Hard runtime cap, non-blocking exit status, spool fallback |
| Native SQLite across runtimes | Single writer in Notification Host only |
| Toasts fail for unpackaged apps or are suppressed | S3 spike; `install` registration; `doctor`; honest "submitted" delivery status |
| Audio/TTS startup latency, AV/EDR flags | S3 spike; provider selection criteria (§10) |
| Command/markup injection via project names | §17.2–17.3, hostile-input tests |
| Same-user spoofing of pipe | Accepted limitation; ACL; validation; alerts only, no actions |
| Agents run in WSL/remote | Declared unsupported; `doctor` detection; roadmap option |
| Corrupted config | Per-key validation with defaults; atomic writes; backups |
| Plugin distribution restrictions vary | Documented install per host; no admin required |
| Schedule slip from unknown host behavior | M0 spikes; re-baseline after M0 |

---

# 22. Future Directions (Non-Binding)

- WSL / SSH / dev-container support via a Windows-side Notification Host reachable from the guest.
- Remote and mobile push channel ("I'm away from my desk"), including an optional self-hosted relay.
- macOS and Linux providers behind the existing interfaces.
- "Away" detection and user-presence heuristics.
- Click-to-focus beyond the P2 stretch goal.
- Per-agent and per-project policy overrides.
- Host-native status panels where hosts support them.
- A review of competing and complementary approaches (native agent notification hooks, terminal bell, relay tools such as push-notification services, existing community plugins) to confirm differentiation. This review SHOULD be completed before Milestone 3 and recorded in `docs/`.

---

# 23. Decision Register and Open Questions

## 23.1 Decisions

| ID | Decision | Status |
|---|---|---|
| D-01 | First integration: **OpenCode v2.0.32**, 5/5 authoritative signals (approval, resolution, turn boundary, completion, failure) in S1. Claude Code 2.1.181 scored 4/5 (no resolution event); Codex CLI 0.155.1 scored 2/5 (approval docs only, no resolution/completion/failure). The adapter must use runtime names `permission.asked`, `permission.replied`, and `session.execution.succeeded\|failed\|interrupted`; documented `session.idle` did not fire. | Decided (S1) |
| D-02 | Add `turn_ended` (inferred) as a first-class event and notification; never claims success | Decided |
| D-03 | Process model: headless Notification Host + shim/in-process adapters; pipe `\\.\pipe\agent-attention-u-<sid8>`; exclusive pipe creation; DACL `D:P(A;;FA;;;SY)(A;;FA;;;OW)` applied before readiness through koffi Win32 calls (no separate helper binary); one bounded retry phase; atomic per-event spool with per-session `sequence`; idle exit after no client/session for `session-live-ms` + `idle-ms`. In-process embedding not selected. | Decided (S2) |
| D-04 | SQLite binding: built-in `node:sqlite` (`DatabaseSync`) on Node.js 24 LTS (tested 24.20.0, bundled SQLite 3.53.4); Notification Host is the single writer and adapters never open the DB. `better-sqlite3@12.4.1` rejected: functionally equivalent via its prebuilt binary, but adds a postinstall native download that fails under `--ignore-scripts` and cannot compile on a host without the MSVC C++ workload. | Decided (S2) |
| D-05 | Preferences only in `config.json` (`%APPDATA%`); state in `%LOCALAPPDATA%`; no preferences table | Decided |
| D-06 | Zod for validation; JSON Schema generated | Decided |
| D-07 | MVP activity surface is the CLI; host-native panels optional | Decided |
| D-08 | Fixture-based adapter tests as the CI gate; small live smoke suite not gating | Decided |
| D-09 | WSL/SSH/dev-container/remote unsupported in MVP; `doctor` detects and reports | Decided |
| D-10 | Audio priority: approval > input > failed > turn_ended > completed; single audio queue | Decided |
| D-11 | Focus suppression applies to all events by default; approval bypass is configurable | Decided |
| D-12 | Reminders ship disabled by default; revisit after dogfooding | Decided |
| D-13 | `taskId` only when the host has a real task concept; otherwise session scope only | Decided |
| D-14 | Subagent completion/turn-end/failure do not notify by default; subagent input/approval do | Decided |
| D-15 | Same-user pipe spoofing is an accepted MVP risk, mitigated by ACL and validation | Decided |
| D-16 | Event contract has no free-text fields; wording from enumerated templates only | Decided |
| D-17 | Terminal states (`completed`, `failed`) are resumable on a new prompt | Decided |
| D-18 | Use npm workspaces instead of pnpm: ships with Node, flat layout is most compatible with host plugin loaders and native modules, and matches the end-user install path. Mitigate loose dependency checking with a CI lint/depcheck step, `npm ci` with a committed lockfile, and tsup bundling. Revisit pnpm only if undeclared-dependency issues recur | Decided |

## 23.2 Open questions

| ID | Question | Resolves in |
|---|---|---|
| Q-01 | Which host exposes the most reliable lifecycle signals? **Answered:** OpenCode (5/5 at runtime; 260/260 unique event IDs; durable `seq`; child `parentID`). | S1 (answered) |
| Q-02 | Can the first host distinguish blocking questions from plain text? **Answered:** yes for typed permission requests; the dedicated question tool was not exercised and remains capability-gated. | S1 (answered) |
| Q-03 | Does the host expose task-level, session-level, or both completion scopes? **Answered:** session-level only for evaluated hosts; no task scope. | S1 (answered) |
| Q-04 | Can the core and shim run natively within each host's runtime (Node/Bun version, module loading)? **Answered for OpenCode:** the TypeScript plugin loaded and ran under the installed v2.0.32 runtime; the host shim uses Node 24.20.0. Other host runtimes are adapter-specific and will be validated at their Phase 5 install. | S1/S2 (answered for first host) |
| Q-05 | Which audio/TTS/toast implementation meets the §10 selection criteria without AV/EDR or latency problems? **Answered:** MCI/koffi sound + fixed PowerShell fallback; fixed SAPI TTS over stdin with a resident worker; per-user AUMID + WinRT toast with a fixed PowerShell sender. Defender clean; third-party EDR and a second Windows build remain residual validation. | S3 (answered) |
| Q-06 | Is foreground-window detection reliable enough for F13? **Answered:** window/process detection is reliable; session attribution is reliable only where the session can supply its own HWND (Windows Terminal via `GetConsoleWindow()` + `GW_OWNER`, classic console). VS Code is unsupported; panes/tabs are window-scoped. | S3 (answered) |
| Q-07 | Is click-to-focus feasible without sending input to the agent? **Answered:** window-management-only routes deliver no input, and attach-to-foreground succeeded 4/4 as a fallback, but a real toast activation was not verified. Keep click-to-focus out of MVP; do not implement task 4.9 until re-probed. | S3 (answered, deferred) |
| Q-08 | Which host event identifiers are stable enough for persistent deduplication? **Answered:** OpenCode `evt_` IDs + per-session `durable.seq`; Claude Code session/prompt/tool IDs without a sequence; Codex session/turn/agent IDs without a sequence. Use `eventId` + sequence where present. | S1 (answered) |
| Q-09 | How should stale sessions be reconciled after host or plugin restarts for hosts without liveness signals? **Answered:** the host is the single writer; on restart it re-reads persisted session state and marks open sessions `unknown`/stale per the §13 rules, ingests the spool idempotently by `eventId`, and never infers completion from a lost connection. OpenCode can backfill with `session.log?after=<seq>&follow=true`. | S1/S2 (answered) |
| Q-10 | Packaging and versioning per host (npm vs host-native plugin formats)? **Deferred to M3:** OpenCode's plugin install path is known, but package naming/versioning and the per-host install format require the Phase 3 install task. Not a Phase 2 gate. | Deferred (M3) |
| Q-11 | Is `minTurnSeconds=15` and `graceMs=1000` the right default? | Dogfood (M4) |
| Q-12 | Should reminders default to enabled? | Dogfood (M4/M5) |
| Q-13 | Which host-native surfaces can expose activity history without a dashboard? **Deferred (optional):** not required for MVP; the CLI is the activity surface (D-07). Revisit after dogfooding. | Deferred (optional) |

Open questions MUST be closed (answered, with a decision ID, or explicitly deferred with rationale) before the Definition of Done is evaluated.

---

# 24. Change Log

| Version | Date | Summary |
|---|---|---|
| 1.0 | 2026-10-19 | Initial MVP specification |
| 2.3 | 2026-10-21 | Closed Phase 2 (M2): recorded the implemented host, SQLite store, shim/spool, audio queue, Windows providers, and doctor/latency path; added `last_accepted_sequence` to §15.1; amended D-03/§10 to apply the pipe DACL in-process through koffi (no separate helper binary) and recorded the M2 outcome in §20; updated the remaining estimate to 17–24 working days for M3–M6. |
| 2.2 | 2026-10-21 | Closed Phase 0 (M0): decided D-01 (OpenCode v2.0.32, 5/5), D-03 (host/pipe/spool with ACL hardening and bounded retry), D-04 (`node:sqlite`); answered Q-05 (MCI/koffi sound + SoundPlayer fallback, fixed SAPI stdin TTS, per-user AUMID + WinRT toast), Q-06 (WT/classic console only; VS Code unsupported), Q-07 (click-to-focus deferred); answered Q-01/Q-02/Q-03/Q-04/Q-08/Q-09; deferred Q-10 (M3) and Q-13 (optional); updated §9.2, §10, §16.3–§16.6, F13-R5, §20 estimates (33–46 total; 23–32 remaining), and the host matrix/fixtures. |
| 2.1 | 2026-10-20 | Replaced pnpm with npm workspaces (D-18): updated §10 tech stack, §11 repository structure (removed `pnpm-workspace.yaml`, added `package-lock.json`), added dependency-hygiene and CI requirements, and decision D-18. |
| 2.0 | 2026-10-20 | Made source of truth. Added: document governance and status tags; `turn_ended`, `approval_resolved`, `resumed`, `session_ended` events; failure notification (F9); turn-ended notification (F10); CLI (F11); audio queue/coalescing/rate limiting (F12); focus awareness (F13); reminders (F14); privacy modes (F15). Revised: state machine (idle, ended, resumable terminal states, ordering, staleness, subagents, task scope); process model (Notification Host, single-writer storage, shim, spool); configuration (single source, v2 schema, resolution rules, voice and per-channel settings, quiet-hour channel flags, DST behavior); deduplication (explicit fingerprint priority, null handling, atomic claim before state mutation); persistence (delivery records, pending requests, dedupe table, migrations, no preferences table); security (injection prevention, safe-name rules, spoofing risk, install without admin); testing (fixtures-first, hostile inputs, restart/storm scenarios); metrics (added precision and outcome signals); milestones (added feasibility spikes; re-baselined to 32–45 days); WSL/remote declared out of scope; first-host selection by scorecard; resolved repository overlap between `notifications` and `platform-windows`; removed copied example data ("Pocket"). |

---

# 25. Final Product Definition

Agent Attention is a plugin ecosystem that detects supported coding-agent lifecycle events and turns them into a consistent, configurable, low-noise notification experience.

Its architecture consists of agent-native adapters, a shared TypeScript core, a common event contract with explicit confidence levels, a headless local Notification Host, local preferences and history, and Windows sound, voice, and desktop notification providers.

The product prioritizes **honest, reliable signals** over broad but unreliable compatibility: classified events are emitted only when the host provides a trustworthy signal, and the turn-ended event covers the common case where it does not, without ever claiming success.

**The defining constraint is that Agent Attention remains a plugin-first product. Users install it into their existing coding-agent environments; they do not need to adopt a separate desktop application.**