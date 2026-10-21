# Phase 4 — Attention Policy, CLI, and History Progress

**Integration branch:** `phase-4-policy-cli-history`  
**Base:** `phase-3-opencode-integration` at `23133df`  
**Status:** In progress

## Branch and worktree allocation

| Worktree branch | Plan scope | Status |
| --- | --- | --- |
| `phase-4-cli-foundation` | Tasks 4.1–4.2 | Initial CLI/IPC/config slices committed |
| `phase-4-cli-queries` | Tasks 4.3–4.4, 4.7 | Initial status/history models committed |
| `phase-4-cli-actions` | Tasks 4.5–4.6 | Initial preview/mute request builders committed |
| `phase-4-host-policy` | Tasks 4.8–4.9 | Not started |
| `phase-4-attention` | Tasks 4.10–4.12 | Not started |
| `phase-4-retention-dogfood` | Tasks 4.13–4.14 | Not started |

## Commits completed

- `68035c3` — CLI command skeleton and bounded IPC request client.
- `74d5206` — config file read/write and host config watcher.
- `3860f21` — status/history query models and status test.
- `1e3d28e` — preview and mute request builders.

## Closure gates remaining

- Complete host policy, focus, reminders, privacy, subagent, retention, and
  dogfood tasks from `docs/plans/05-phase-4-policy-cli-history.md`.
- Integrate command modules into the executable CLI and host lifecycle.
- Run the full unit/integration suite and `npm run ci` with dependencies
  installed in the Phase 4 integration worktree.
- Map F4–F15 acceptance criteria to tests and record any supported-capability
  exceptions.
- Write the final Milestone 4 outcome in `PRD.md` and update the master plan.

No Phase 4 changes have been merged into `main`.
