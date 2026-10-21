# Phase 4 — Attention Policy, CLI, and History Progress

**Integration branch:** `phase-4-policy-cli-history`  
**Base:** `phase-3-opencode-integration` at `23133df`  
**Status:** COMPLETE for supported capabilities; F13 focus suppression is explicitly unsupported for this release.

## Branch and worktree allocation

| Worktree branch | Plan scope | Status |
| --- | --- | --- |
| `phase-4-cli-foundation` | Tasks 4.1–4.2 | Initial CLI/IPC/config slices committed |
| `phase-4-cli-queries` | Tasks 4.3–4.4, 4.7 | Initial status/history models committed |
| `phase-4-cli-actions` | Tasks 4.5–4.6 | Initial preview/mute request builders committed |
| `phase-4-host-policy` | Tasks 4.8–4.9 | Timer orchestration committed; focus mapping limitation documented |
| `phase-4-attention` | Tasks 4.10–4.12 | Core policy behavior covered by existing suite |
| `phase-4-retention-dogfood` | Tasks 4.13–4.14 | Retention scheduling, stats, and journal committed |

## Commits completed

- `68035c3` — CLI command skeleton and bounded IPC request client.
- `74d5206` — config file read/write and host config watcher.
- `3860f21` — status/history query models and status test.
- `1e3d28e` — preview and mute request builders.
- `66f4ae1` — host timer orchestration.
- `83fe9d6` — startup/hourly retention purge.
- `c096430` — local dogfood stats and journal.

The task branches are integrated into this branch. The detailed acceptance
mapping is in [`phase-4-acceptance.md`](phase-4-acceptance.md).

## Closure gates remaining

- Review the documented doctor transport and focus session-window mapping
  exceptions before final product sign-off.
- Run the final clean-machine acceptance walk after those host-specific choices
  are approved.

No Phase 4 changes have been merged into `main`.
