# Codex — S1 third-host probe

Throwaway evidence code for Task 0.4. Do not promote into an adapter.

- Chosen host: **Codex CLI 0.155.1** (`codex-cli 0.155.1`, Windows 10.0.26300.9711).
- Mechanism probed: documented lifecycle hooks (`hooks.json` / `[hooks]`), plus the
  documented app-server approval surface for a permission attempt.
- Results record: [`../../../docs/spikes/phase-0-shards/s1-third-host.md`](../../../docs/spikes/phase-0-shards/s1-third-host.md).

## Files

| File | Purpose |
|---|---|
| `probe-hook.mjs` | Reads the documented hook JSON from stdin and appends one JSONL record per invocation. Silent on stdout, so it never decides or blocks. |
| `profile/config.toml` | Throwaway `CODEX_HOME` config; enables the documented `hooks` feature. |
| `profile/hooks.json` | Probe registrations for `SessionStart`, `PermissionRequest`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`, `Interrupt`, `SessionEnd`. |
| `render-hooks.mjs` | Regenerates `profile/hooks.json` with this checkout's absolute probe path. |
| `probe-app-server.mjs` | Drives the documented app-server JSON-RPC surface to produce a real command approval request. |

`profile/` is a throwaway `CODEX_HOME`. Its `.gitignore` excludes `auth.json`,
session logs, and generated state. Captures land in `../out/codex/*.jsonl`
(gitignored by the repository's `spikes/**/out/` rule).

## Reproduce

```powershell
# 1. Throwaway profile. Copy the existing login only into this gitignored profile.
$profile = "<repo>\spikes\s1-host-signals\codex\profile"
Copy-Item "$env:USERPROFILE\.codex\auth.json" "$profile\auth.json"
node spikes/s1-host-signals/codex/render-hooks.mjs

# 2. Plain-text turn: expect SessionStart, UserPromptSubmit, Stop, SessionEnd.
$env:CODEX_HOME = $profile
$env:S1_RUN_LABEL = "turn-end"
codex exec --skip-git-repo-check --dangerously-bypass-hook-trust --json `
  -C spikes/s1-host-signals/codex/workspace `
  "Reply with exactly: PROBE_TURN_END"

# 3. Subagent turn: expect SubagentStart and SubagentStop with agent_id.
$env:S1_RUN_LABEL = "subagent"
codex exec --skip-git-repo-check --dangerously-bypass-hook-trust --json `
  -C spikes/s1-host-signals/codex/workspace `
  "Use the spawn_agent tool to launch one subagent ..."

# 4. Approval attempt (app-server): sends a real
#    item/commandExecution/requestApproval, then declines it.
node spikes/s1-host-signals/codex/probe-app-server.mjs
```

`--dangerously-bypass-hook-trust` is used only because this throwaway profile has
no persisted hook-trust record. It does not bypass approvals or the sandbox.

## Result of the probe

- Hooks ran and produced captures for SessionStart, UserPromptSubmit, Stop,
  SessionEnd, SubagentStart, and SubagentStop.
- No `PermissionRequest` hook ran in either `codex exec` or the app-server
  attempt. `codex exec` blocks by policy instead of requesting approval; the
  app-server did emit a genuine approval request, but skipped the untrusted
  probe hooks. See the shard for the exact [Blocked] record.
- `Stop` carries `turn_id` and `last_assistant_message`; `SessionEnd` carries
  `reason: "other"`.
