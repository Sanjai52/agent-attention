# Agent Attention

Windows-native notifications for coding agents.

Agent Attention tells you when an agent needs attention without requiring you
to watch every terminal. It normalizes host lifecycle signals into a shared
event contract, persists activity locally, applies alert policy, and delivers
notifications through sound, voice, and Windows desktop toasts.

## Project status

The MVP implementation is integrated on the main branch. OpenCode is the
primary supported integration. Claude Code has a functional hook adapter with
a narrower, explicitly declared capability set.

Phase 6 hardening evidence is documented, but final release certification still
requires clean-profile verification, a second Windows build, true kill/restart
measurements, and release-candidate validation.

## Supported environment

| Requirement                             | Support                                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| Operating system                        | Windows 10/11                                                 |
| Runtime                                 | Node.js 24.20 or newer                                        |
| OpenCode                                | Verified against v2.0.32                                      |
| Claude Code                             | Evidence based on 2.1.181; hook delivery exercised on 2.1.306 |
| Administrator rights                    | Not required for the intended per-user installation           |
| WSL, SSH, containers, remote workspaces | Unsupported; reported by doctor                               |

## Integration capabilities

### OpenCode

Supported: session start, coarse progress, approval requests, approval
resolution, successful completion, failures, interrupted turns, stable event
ordering, concurrent sessions, and subagent identity.

Unsupported: general blocking questions, resume signals, and verified
session-ended signals.

### Claude Code

Supported: session start, approval requests, inferred approval resolution,
inferred turn end, failures, and session end.

Unsupported: verified successful completion, progress, general blocking
questions, resume, sequence numbers, subagent identity, and liveness.

### Other hosts

Codex CLI and Gemini CLI are not implemented or published in the MVP.

See docs/capability-status.md for the complete capability map and evidence
boundaries.

## Architecture

    Agent host
       |
       v
    Thin adapter --> shared event contract --> Notification Host
                                                    |
                         +--------------------------+----------------------+
                         v                          v                      v
                    SQLite state              Policy engine          Windows providers
                    and history               and dispatch            sound / voice / toast

- Adapters discover host signals and emit validated events.
- The pure core owns ordering, state, deduplication, policy, and templates.
- The Notification Host is the single SQLite writer.
- The CLI is the activity surface; there is no tray app or standalone desktop
  application.
- Preferences live in the per-user AppData AgentAttention config file.
- State and history live in the per-user LocalAppData AgentAttention directory.

## Installation

Requirements: Windows 10/11, Node.js 24.20 or newer, and a native agent
process.

Install the per-user Windows notification identity:

    agent-attention install --host windows

Install the OpenCode plugin using its absolute plugin directory:

    agent-attention install --host opencode --config <opencode.jsonc> --plugin <absolute-plugin-directory>

Install Claude Code hooks:

    agent-attention install --host claude-code --command "agent-attention claude-hook"

Use the settings option for an alternate Claude settings file. Installers are
idempotent, back up existing configuration, preserve unrelated user entries,
and uninstall only entries owned by Agent Attention.

Verify the installation:

    agent-attention doctor --json
    agent-attention status --json
    agent-attention history --json

Release packaging and supported versions are listed in
docs/compatibility.md.

## CLI

    agent-attention doctor       Diagnose host, pipe, database, providers, and adapters
    agent-attention status       Show current agent/session status
    agent-attention history      Query persisted activity
    agent-attention preview      Test sound, voice, or desktop delivery
    agent-attention mute         Mute or unmute alert delivery
    agent-attention config       Read or update preferences
    agent-attention install      Install a host integration
    agent-attention uninstall    Remove a host integration

Use the JSON option for automation-friendly output.

## Development

    npm ci
    npm run ci

The CI command runs ESLint, dependency checks, TypeScript typechecking, unit
and integration tests, and workspace builds.

Useful individual commands:

    npm run test
    npm run typecheck
    npm run build
    npm run lint
    npm run format:check

## Verification

The current integrated gate covers 60 test files and 624 tests. Phase 6 added:

- Security and hostile-input injection matrix.
- Real pipe/SQLite storm persistence and replay-deduplication tests.
- A–Q acceptance coverage.
- Release packaging workflow.
- Compatibility documentation.
- Capability-status documentation.

Evidence and limitations are recorded in:

- docs/pre-testing-report.md
- docs/security-review.md
- docs/performance-report.md
- docs/acceptance-report.md
- docs/compatibility.md

## Limitations and future work

- Clean-profile and second-Windows-build release verification remain open.
- True process-kill storm recovery and hook-to-audible latency need final
  measurements.
- Focus suppression is unsupported for VS Code/OpenCode.
- Same-user pipe spoofing is an accepted MVP risk; spoofed events can create
  alerts but cannot control an agent.
- Codex/Gemini adapters, richer input/resume signals, verified Claude
  completion, click-to-focus, remote/WSL support, and broader policy scopes are
  future work.

## Documentation

- Product requirements: PRD.md
- Architecture: docs/architecture.md
- Event contract: docs/event-contract.md
- Capability status: docs/capability-status.md
- Host signal matrix: docs/host-signal-matrix.md
- Installation guide: docs/installation.md
- Troubleshooting: docs/troubleshooting.md
- Adapter development: docs/adapter-development.md
- Phase plans: docs/plans/00-master-plan.md

## License

License information will be added before public release.
