# Agent Attention

Cross-agent notification plugin ecosystem for coding agents. Know when your coding
agent needs you — without constantly watching it.

- **Source of truth:** [`PRD.md`](./PRD.md) (v2.3). If anything disagrees with the PRD, the PRD wins.
- **Implementation plans:** [`docs/plans/`](./docs/plans/00-master-plan.md) — phase-by-phase, task-and-TDD granular.
- **Status:** Phases 0–5 are implemented and merged: feasibility decisions,
  strict event contract and pure core, headless host, SQLite storage,
  shim/spool, Windows providers, OpenCode and Claude Code adapters, installers,
  CLI, policy, history, and shared adapter verification. Phase 6 hardening and
  release remains. Reports:
  [`phase-0.md`](./docs/phase-0.md), [`phase-1.md`](./docs/phase-1.md),
  [`phase-2.md`](./docs/phase-2.md).

## Repository layout

```text
packages/    contract, core, storage, notifications, platform-windows, host, shim, cli
adapters/    opencode, claude-code, codex, gemini-cli
tests/       fixtures, unit, integration, acceptance, live-smoke
docs/        plans, architecture, event-contract, adapter-development, host-signal-matrix, ...
spikes/      throwaway feasibility prototypes (S1–S3)
```

## Development

```bash
npm ci
npm run ci        # lint + typecheck + tests + build
npm run test      # Vitest
npm run typecheck
npm run build
```

Node.js 24 is the development runtime; the supported range is pinned in PRD §10 after
spikes S1/S2.

## Scope (MVP)

Windows 10/11, native agent processes only. No standalone desktop application; the CLI
is the activity surface. Preferences live in `%APPDATA%\AgentAttention\config.json`;
state and history in `%LOCALAPPDATA%\AgentAttention\`. WSL/SSH/dev containers are
unsupported and reported by `agent-attention doctor`.
