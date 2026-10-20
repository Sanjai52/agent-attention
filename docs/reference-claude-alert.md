# Reference Analysis — Claude Alert

**Status:** read-only reference, not normative. `PRD.md` remains the source of truth.
**Reference:** [`wilbert-t/claude-alert`](https://github.com/wilbert-t/claude-alert) at
commit `1139cfe`, package version `1.1.1`, MIT license, analyzed 2026-10-20.
**Location:** `ref/claude-alert/` (gitignored, excluded from build, lint, and tests).

## 1. Bottom line

Claude Alert is a single-host notification plugin for Claude Code. It is useful as
a **behavioral and UX reference** for hook registration, fail-open hook scripts,
approval-pending state, notification anatomy, and macOS click-to-focus. It is
**not a structural model** for Agent Attention: policy, privacy, Windows
delivery, persistence, and lifecycle state all diverge from our contract.

Use it to answer: "What should the alert feel like, and how does a hook stay out
of the agent's way?" Do not use it to answer: "How should our core, adapters,
storage, or Windows providers be built?"

## 2. What it does

- Registers four Claude Code hooks: `PreToolUse`, `PostToolUse`, `Notification`,
  and `Stop`.
- Classifies every tool call as low/medium/high risk with regex rules, tool
  categories, user patterns, and trusted paths.
- Silently auto-approves low-risk calls by default.
- Writes a pending-approval record and fires a native notification for
  medium/high calls.
- Keeps an approval audit log, user settings, error log, and menu-bar state in
  `~/.claude-notifier/`.
- Optionally ships a macOS SwiftUI menu-bar companion with an animated robot
  that reflects pending risk and celebrations.
- Installs as a Claude Code plugin, via `npx claude-alert install`, or from a
  clone for the companion app.

| Platform | Notification mechanism                                      | Sound                                   | Click-to-focus       |
| -------- | ----------------------------------------------------------- | --------------------------------------- | -------------------- |
| macOS    | `terminal-notifier` (SHA256-verified), `osascript` fallback | Default sound via `terminal-notifier`   | `open -b <bundleId>` |
| Windows  | Detached PowerShell `NotifyIcon.ShowBalloonTip`             | OS default only; no selection or volume | Not implemented      |
| Linux    | `notify-send`, `wall` fallback                              | OS default only                         | Not implemented      |

## 3. Hook flow

```text
Claude Code
  |-- PreToolUse ----> pre-tool.js ----> classify risk
  |                                      |-- low/trusted -> stdout {"decision":"approve"}
  |                                      `-- med/high ---> pending-approval.json
  |                                                        + state.json
  |                                                        + notify()
  |-- PostToolUse ---> post-tool.js ---> clear pending + celebrate
  |-- Notification --> notify.js ------> classify + audit + rate limit + notify
  `-- Stop ----------> on-stop.js -----> state = celebrating

~/.claude-notifier/ state files <---- optional Swift menu-bar app (macOS)
```

| Hook           | Script                 | What it actually does                                                                                                              |
| -------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `PreToolUse`   | `scripts/pre-tool.js`  | Reads `tool_name` / `tool_input`; applies trusted paths and `autoApproveLevel`; writes pending approval; notifies; always exits 0. |
| `PostToolUse`  | `scripts/post-tool.js` | Drains stdin; if a pending file exists, clears it and sets `celebrating`.                                                          |
| `Notification` | `scripts/notify.js`    | Reads a different payload shape (`tool` / `input`); classifies, audits, applies a 3 s / 10-per-minute limiter, notifies.           |
| `Stop`         | `scripts/on-stop.js`   | Overwrites `state.json` with `celebrating`.                                                                                        |

The two notification paths (`PreToolUse` and `Notification`) are independent and
the limiter only covers `notify.js`, so duplicate or over-alerting behavior is
possible. This is a warning for our own single-dispatch design.

## 4. Notification anatomy

The macOS banner uses:

- Title: `<risk emoji> <risk label> — <tool>` (for example `🔴 High Risk — Bash`).
- Subtitle: `Approval needed — tap to open terminal`.
- Body: a generated impact sentence plus a truncated command preview.
- Action: `Open Terminal` (foreground action), which focuses the source app.
- One alert at a time: all delivered and pending notifications are removed
  before posting another.

`notify.js` uses the same idea with a configurable title, optional risk badge,
and optional command preview. Notification text is truncated to 100/200 chars
before platform delivery. Windows values are quote-stripped and interpolated
into a PowerShell `-Command` string.

The Swift variant uses a `UNNotificationCategory` with an `Open Terminal`
action, tracks `id -> source bundle/app` in memory, and dismisses all delivered
notifications when the pending file disappears. It deliberately does **not**
send approve/reject input to the agent; tapping only focuses the terminal so the
user can answer Claude Code's native prompt.

### State and menu-bar cadence

`state.json` uses `idle`, `pending_low`, `pending_medium`, `pending_high`, and
`celebrating`. The menu bar watches the file with `DispatchSource` (500 ms timer
only while the file does not exist) and animates at these intervals:

| State            | Frame interval             |
| ---------------- | -------------------------- |
| `idle`           | 500 ms                     |
| `pending_low`    | 250 ms                     |
| `pending_medium` | 167 ms                     |
| `pending_high`   | 100 ms                     |
| `celebrating`    | 100 ms, 12 ticks then idle |

Clicking the menu bar reads `sourceApp`, `sourceBundleId`, and `sourceCwd` from
`pending-approval.json`; VS Code is focused at the working directory, other
terminals by bundle ID.

## 5. Strengths worth borrowing

| Pattern                        | Why it is useful                                                                      | Where it maps in Agent Attention                                     |
| ------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Four lifecycle hooks           | Shows where Claude Code exposes approval, resolution, stop, and notification moments. | Claude Code adapter discovery (Phase 0 S1 / Phase 3).                |
| Fail-open hooks                | Every script catches errors, logs, and exits 0 so the agent is never blocked.         | Shim budget and host isolation (Phase 2).                            |
| Pending file + post-tool clear | A simple open/close request model that survives process boundaries.                   | `pending_requests` and `approval_resolved` semantics in the core.    |
| Stable script copy             | Installer copies scripts out of the npx cache so hooks keep working.                  | Installer design (Phase 4/6).                                        |
| Supply-chain checks            | SHA256 plus `codesign`/`spctl` before running a downloaded binary.                    | Any future downloaded provider or helper.                            |
| Alert anatomy                  | Risk badge, short impact line, one actionable banner.                                 | Presentation templates; replace free text with enumerated summaries. |
| One live alert + stable ID     | Prevents a stack of stale banners for the same request.                               | Coalescing and per-request replacement in the core.                  |
| Click-to-focus only            | Focuses the host window without injecting input.                                      | F13/F6-R11 click-to-focus, still gated on S3.                        |
| State-driven animation         | Concrete pacing for idle/pending/celebrating states.                                  | Only if a future host-native activity surface is approved.           |
| Settings validation + CLI      | `config`, `--get`, `--set`, `--open` is a clean user surface.                         | CLI config/preview commands in Phase 4.                              |
| Injectable platform argument   | `_platform` makes platform branches unit-testable.                                    | Provider testability pattern.                                        |

## 6. Do not copy

| Pattern                                                     | Problem                                                                                                    | Our rule                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Auto-approving low-risk tools inside the notification layer | Mixes notification policy with security policy and mutates host behavior.                                  | Adapters normalize only; core applies notification policy. Auto-approval is out of scope. |
| Raw command previews in banners and audit logs              | Leaks command arguments and tool payloads.                                                                 | No free text from agents; F3-R7/F15. Use enumerated `summaryCode` and safe names.         |
| Interpolating values into a PowerShell `-Command`           | Weak escaping; hostile command text approaches the shell boundary.                                         | Fixed scripts; data via stdin or argv; PRD §17.2.                                         |
| Read-modify-write JSON audit                                | Concurrent hooks can lose entries; no schema or migration.                                                 | SQLite single writer; delivery and event records in the host.                             |
| `removeAllDeliveredNotifications()`                         | Hides alerts for unrelated sessions/windows.                                                               | Coalesce per window/request; do not globally clear another session's alert.               |
| Two independent notification paths                          | Duplicate alerts and inconsistent payload assumptions.                                                     | One dispatch path after persistence.                                                      |
| Quiet hours calculated but not applied                      | `isMuted` is computed in `notify.js` and then never used.                                                  | Core quiet-hours policy with per-channel suppression.                                     |
| Balloon tips as the Windows strategy                        | Legacy API, no AUMID/action support, no sound control, one PowerShell process kept alive per notification. | Toast with registration and `doctor` honesty; S3 still owns the mechanism decision.       |
| Unknown tools default to `medium`; Bash always high         | Over-alerts on safe work and treats risk as a notification class.                                          | Notify on trustworthy event classes, not regex guesses.                                   |
| Non-atomic settings rewrite                                 | Re-serializes `~/.claude/settings.json` with no backup; partial `uninstall` leaves hooks behind.           | Transactional install/uninstall with exact ownership tracking.                            |
| Tests against the real home directory                       | Settings tests write to the developer's `~/.claude-notifier`.                                              | Temp-dir fixtures and dependency injection.                                               |
| No delivery records                                         | Cannot distinguish submitted from seen, or suppressed from failed.                                         | `event_deliveries` with `delivered                                                        | failed | unavailable` and suppression reasons. |

## 7. Gaps against our PRD

| Area                   | Claude Alert                                          | Agent Attention requirement                                     |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Event taxonomy         | Risk levels plus four hooks                           | 11 event types, confidence, request IDs, tasks, subagents       |
| Policy ownership       | Hook scripts do classification, policy, and delivery  | Pure core owns policy; host owns effects; adapters normalize    |
| Privacy                | Command snippets in banners, audit, and pending files | No free text, discreet modes, safe names                        |
| Windows delivery       | Balloon tip, no AUMID, no action, no explicit sound   | Toast registration, `doctor`, submit-vs-seen honesty            |
| Resolution             | `PostToolUse` implies approval                        | `approval_resolved` / `resumed` with request IDs and confidence |
| Focus                  | macOS bundle ID only                                  | Q-06/Q-07 open; Windows focus evidence required                 |
| Persistence            | JSON files under the home directory                   | SQLite under `%LOCALAPPDATA%`, single writer, migrations        |
| Channels               | Banner plus default OS sound                          | Per-event sound, independent volume, optional TTS, desktop      |
| Rate limiting          | 3 s cooldown, 10/min, only in one hook                | Priority-aware rolling window and bypass in the core            |
| Quiet hours            | Implemented but not enforced                          | Cross-midnight, per-channel flags, no replay burst              |
| Reminders / coalescing | None                                                  | Reminder planning, same-window grouping, summaries              |
| Multi-agent            | Claude Code only                                      | Cross-agent adapters and shared history                         |

## 8. Windows evidence

The reference does **not** close Q-05, Q-06, or Q-07:

- `NotifyIcon.ShowBalloonTip` is not a Windows toast and has no application
  identity, action button, or click activation.
- A detached PowerShell process sleeps 4.5 s per notification to keep the
  balloon alive. That is not a viable per-event cost model.
- No sound selection, volume control, or TTS exists on the Windows path; the
  README's "sound alerts" claim is only implemented explicitly on macOS.
- No Windows foreground-window or click-to-focus implementation exists.

It is evidence that a legacy fallback can be made to work, not evidence that our
required toast/registration/diagnostic path works. Phase 0 S3 remains necessary.

## 9. Claude Code adapter notes

These are observations about the reference, not verified host behavior:

- The plugin registers hooks through `.claude-plugin/plugin.json` plus
  `hooks/hooks.json` using `${CLAUDE_PLUGIN_ROOT}`; npm mode edits
  `~/.claude/settings.json`.
- `PreToolUse` assumes `tool_name` and `tool_input`; `Notification` assumes
  `tool` and `input`. The inconsistency suggests the payload contracts were not
  confirmed from one authoritative source. Verify both in S1.
- `PreToolUse` runs for every tool use, not only approvals. Treating every call
  as a notification candidate risks over-alerting; the `Notification` hook may
  be the better approval signal, but that must be verified.
- `PostToolUse` can infer that a pending request was resolved, but it cannot by
  itself distinguish approved from denied. Our contract must mark such a
  resolution `inferred` unless a trustworthy signal exists.
- Hook timeouts are 10 s for pre/post tool and 5 s for notification/stop. Our
  shim's 1000 ms cap is deliberately stricter.
- The `approval-response.json` hand-off is dead code in the current version;
  the shipped notification action only focuses the terminal. This aligns with
  our rule that click-to-focus must not send input to the agent.

## 10. Recommendations for our design

1. Keep a single notification dispatch path after persistence; adapters emit
   normalized events only.
2. Reuse the alert anatomy (short label, one contextual line, one action) but
   source the text from templates and enumerated summaries, never raw commands.
3. Model pending approvals as request open/close events. Treat `PostToolUse` as
   inferred resolution until S1 proves otherwise.
4. Prefer one live notification per request/session over a global clear; let the
   core coalesce.
5. Keep hooks fail-open and budget-bound. A notification failure must never
   block the agent or erase the event.
6. Build the Windows provider around toast registration and honest delivery
   records; keep a balloon only as an explicitly diagnosed fallback.
7. Treat click-to-focus as focus only: never send approve/deny input to the
   agent.
8. Copy the installer's stable-script and checksum ideas, not its settings
   rewrite or incomplete uninstall.
9. Do not adopt the menu-bar animation in the MVP; the PRD has no standalone
   desktop app. Keep the state cadence as a reference for a future host surface.
10. Use the reference as a source of hypotheses for S1/S3, not as evidence for a
    matrix cell. Only `[Verified]` official docs or captures can do that.

## 11. Open questions for Phase 0

- Which Claude Code hook is authoritative for approvals, and which for input
  requests? What are the exact payloads in the pinned version?
- Does `PreToolUse` fire for auto-approved or read-only tools? Does the current
  version support a `decision` response, and is it safe to use?
- Does `PostToolUse` fire after a denial as well as an approval? Is there any
  signal that distinguishes them?
- When does the `Notification` hook fire: approvals, idle, or both? What fields
  does it carry?
- Can a plugin register hooks without editing user settings, and is
  `${CLAUDE_PLUGIN_ROOT}` stable across npx cache changes?
- On Windows, can an unpackaged Node process show a real toast with a per-user
  AUMID? Does click activation work? How is Focus Assist detected?
- Is a balloon tip still shown on Windows 10/11 when Focus Assist is enabled?
- What is the cost of a short-lived PowerShell process per notification, and
  can sound/TTS be delivered without a window?

## 12. Key files

| Path                                                    | Read for                                             |
| ------------------------------------------------------- | ---------------------------------------------------- |
| `hooks/hooks.json`                                      | Hook registration and timeouts                       |
| `scripts/pre-tool.js`                                   | Approval detection, auto-approve, pending record     |
| `scripts/post-tool.js`                                  | Resolution inference and cleanup                     |
| `scripts/notify.js`                                     | Alert wording, audit, rate limiting, quiet-hours bug |
| `scripts/risk.js`                                       | Risk rules and impact-string generation              |
| `scripts/platform.js`                                   | macOS/Windows/Linux delivery and focus               |
| `scripts/settings.js`                                   | Settings defaults, validation, quiet-hours math      |
| `scripts/audit.js`                                      | JSON audit storage and retention                     |
| `scripts/character-state.js`                            | State schema and event log                           |
| `swift-app/ClaudeNotifier/NotificationController.swift` | Banner categories, action, dismissal                 |
| `swift-app/ClaudeNotifier/StatusBarController.swift`    | State animation and focus                            |
| `setup/install.js`                                      | Hook installation and supply-chain checks            |
| `setup/uninstall.js`                                    | Hook removal and cleanup                             |
| `SECURITY.md`                                           | Data inventory and permission claims                 |
