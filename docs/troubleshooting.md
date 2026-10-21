# Troubleshooting

> Latency smoke (Phase 2, Windows): receipt→response p95 **40.7 ms** in the
> recorded isolated run and **75.3–80.3 ms** in the final full-gate runs for 500
> `agent.progress` events (**147.5 ms** in a separate parallel-load run);
> receipt→dispatch p95 **3.4–4.2 ms** for 50 `agent.needs_input` events.
> Target: p95 < 500 ms.

Status: Phase 2 doctor glossary, Phase 4 CLI rendering, and Phase 3/5 host
sections are implemented. Clean-profile release troubleshooting remains Phase 6.
Source of truth: `PRD.md` §7.1, §17.5, F11-R1.

## Doctor glossary

Phase 2 placeholder; Phase 4 Task 4.7 renders the report as `ok | warn | fail`.
`agent-attention doctor --json` emits the same fields. A probe never plays audio,
speaks, or shows a toast.

| Field | Meaning | Warn/fail guidance |
|---|---|---|
| `windowsVersion` | Windows build string (`os.version()` plus release), or `not-windows` off Windows | Supported hosts are Windows 10/11. Non-Windows is unsupported (D-09); continue only for diagnostics. |
| `nodeVersion` | `process.version` of the process that collected the report | Must be Node ≥ 24.20 because storage uses built-in `node:sqlite`. |
| `host.running` / `host.pid` | Whether the named pipe answered, and the answering host PID | Not running: start the host or let the next adapter event spawn it. |
| `pipe.name` / `pipe.reachable` | Full per-user pipe name and a live reachability result | Unreachable with the host running usually means an ACL or crash problem; check the host log. |
| `database.schemaVersion` | Highest applied row in `schema_migrations` | `0` or a version below the current schema means the DB never migrated; run the host once to migrate. |
| `database.healthy` | A lightweight `SELECT 1` plus schema-version read succeeded | False: the DB is closed, locked, corrupt, or missing `schema_migrations`. Back up the file before repair. |
| `database.path` | Resolved SQLite file path | Confirms which profile/data directory doctor inspected. |
| `config.valid` / `config.diagnostics` | Whether config parsing produced no diagnostics, and the exact diagnostics | Invalid values fall back per key; the `keyPath` names the setting to fix (PRD §8.1). |
| `audio.available` | Sound provider/device probe | False: no output device, audio service stopped, or the sound script failed. Sound delivery will be `unavailable`. |
| `tts.available` / `tts.voices` | Speech provider probe and installed voice names | False or empty voices: no SAPI voice installed; speech is skipped without blocking other channels. |
| `toast.registered` | The per-user AUMID registry key and Start Menu shortcut both exist (AC-F6-07) | False: run `agent-attention install <host>` (or the installer) to register the toast identity. Registration does not guarantee the user saw a toast; Focus Assist/DND may still hide it (F6-R10). |
| `focus.supported` | Whether this host can map a session to its terminal window | Supported only for Windows Terminal and classic console; VS Code and unknown hosts are `false` (Q-06/F13-R5). Unsupported means no focus suppression, never a guessed suppression. |
| `environment.wsl` / `.ssh` / `.container` | Detection from `WSL_DISTRO_NAME`/`/proc/version`, `SSH_CONNECTION`/`SSH_CLIENT`, and container sentinels | Any `true` means an unsupported environment (AC-F11-02, D-09). Alerts may not reach the desktop; detection never blocks the host. |
| `adapters` | Per-adapter capability matrix (`AdapterCapabilities`) | `unsupported` events are not expected from that adapter; `inferred` warns that confidence and false-alert targets apply. |

## Common situations

- No alerts at all: host not running, global mute, quiet hours, focus suppression, channel disabled
- Alerts but no sound: audio device unavailable, sound file invalid, volume 0
- No voice: voice disabled per event, no TTS voice installed, unsafe name omitted
- No toasts: registration missing, Focus Assist/DND, notifications disabled for the app
- Agent runs under WSL/SSH/container: unsupported environment (D-09), what to expect
- Host restarted: sessions show `unknown` until new activity (PRD §13.4)
- Deduplicated what looked like two events: fingerprint explanation (PRD §14.4)

## Host-specific notes

### Claude Code

- `PermissionRequest` is verified for interactive TUI sessions but is not
  expected in headless `claude -p` mode; the adapter reports that capability
  boundary rather than claiming approval coverage universally.
- `Stop` maps to an inferred `turn_ended`, never `completed`.
- `PostToolUse` can infer an approved resolution; denial has no reliable
  resolution hook and remains unknown to the adapter.
- `StopFailure` and `PostToolUseFailure` map to authoritative failure events.
- If hooks appear to delay Claude Code, verify the installed command uses the
  asynchronous hook configuration and that the shim has not been replaced by
  a blocking wrapper.
- Run the manual capture harness after a host upgrade:
  `npx tsx tests/live-smoke/claude-code.smoke.ts`.

## Dogfood journal

See `dogfood-journal.md` (created in Phase 4 Task 4.14).
