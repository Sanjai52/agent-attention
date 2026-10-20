# Claude Code — S1 host-signal probe

Throwaway spike code. Do not promote to `adapters/` or `packages/`.

Question: which documented Claude Code hook events provide approval, resolution,
turn-boundary, completion, and failure signals on Windows, what are their exact
payloads, and do hooks block the host?

## Files

| File | Purpose |
|---|---|
| `hooks/probe.cjs` | Reads one hook payload from stdin, appends the raw JSON plus timing to `out/claude-code/<run-id>.jsonl`, exits 0 |
| `settings.template.json` | Registers the probe for every event under test; `__PROBE_JS__` is replaced with an absolute path |
| `prepare.cjs` | Builds a throwaway `CLAUDE_CONFIG_DIR` under `out/claude-code/config`, copies the user's credentials **into that directory only**, and writes `settings.json`. Never edits `~/.claude` |
| `mock-anthropic.cjs` | Local mock of the Anthropic Messages API used because the installed OAuth token is expired. The host, hooks, and permission dialog are real; only model output is mocked |
| `drive_interactive.py` | Runs the real TUI under a Windows pseudo-console (`pywinpty`) so a permission dialog can be answered with `1`+Enter (approve) or Esc (deny) |

## Reproduce

```powershell
# from the worktree root
node spikes/s1-host-signals/claude-code/prepare.cjs

# terminal 1
node spikes/s1-host-signals/claude-code/mock-anthropic.cjs 8787

# terminal 2
$env:CLAUDE_CONFIG_DIR = "$PWD\spikes\s1-host-signals\out\claude-code\config"
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8787"
$env:ANTHROPIC_API_KEY = "sk-ant-api03-probe"
$env:PROBE_RUN_ID     = "tui-approve"
cd spikes/s1-host-signals/out/claude-code/sandbox
python ..\..\..\claude-code\drive_interactive.py --prompt TOOL_OK --answer yes --out ../tui-approve.log
```

Plain-text turn and timing runs use the same profile:

```powershell
claude -p --permission-mode default "PLAIN"
claude -p --permission-mode default --allowedTools=Bash "TOOL_OK"
```

Set `PROBE_SLEEP_MS=3000` and `PROBE_SLEEP_EVENTS=PreToolUse` (or `PostToolUse`,
`Stop`) to test whether the host waits for the hook.

## Cleanup

`node spikes/s1-host-signals/claude-code/prepare.cjs --clean` removes the
temporary profile (including the copied credential file) and the sandbox. The
whole `out/` tree is gitignored.

## Limitations

- The installed OAuth token expired 2026-06-18 and `claude -p` returned
  `401 OAuth access token is invalid`, so model calls go to `mock-anthropic.cjs`.
- Permission decisions are real TUI decisions delivered as keystrokes through a
  pseudo-console; no approval input is ever sent to the agent by this probe.
- Hook runtime was measured on a warm OS cache. "Cold" below means the first
  hook process of a new host process, not the first after a reboot.
