# S1 OpenCode probe

Throwaway probe for Task 0.2. It records what OpenCode v2.0.32 actually delivers
to a documented plugin: lifecycle, the public event stream, the prompt hook, and
polled pending-permission state. Evidence only — do not promote to an adapter.

## Question

Which PRD §16.1 signals are authoritative at runtime on OpenCode v2.0.32, and
which documented event names do not exist?

## Method

- Private config: `config/opencode.json`, passed with `OPENCODE_CONFIG`.
- Project config discovery disabled: `OPENCODE_CONFIG_PROJECT_DISABLE=1`.
- Private server: `opencode serve --hostname 127.0.0.1 --port <port>` per
  scenario, with `OPENCODE_SERVER_PASSWORD` set and HTTP Basic auth
  (`opencode:<password>`).
- Probe plugin: `config/probe/index.ts`, referenced by the private config.
- Captures: `../out/opencode/<scenario>.jsonl` plus `../out/opencode/run.json`
  (gitignored).

The user's global `~/.config/opencode/opencode.jsonc` is **not modified**. The
v2.0.32 config loader still merges it, so the global `superpowers` plugin and
MCP servers are present during captures; `OPENCODE_CONFIG_CONTENT` is used to
disable the two MCP servers for faster startup. This is disclosed because it is
a limitation of config isolation in this host version.

`config/opencode.json` contains a checkout-specific absolute path to
`config/probe`; edit that one line before running from another worktree. The file
default model is `github-copilot/claude-haiku-4.5`, but the driver sets the
session model explicitly on every `POST /api/session`: `opencode/deepseek-v4.1-flash-free`
except for `error-invalid-model`, which requests `github-copilot/claude-haiku-4.5`
to provoke a provider error.

## Reproduce

From the repository root:

```powershell
node spikes/s1-host-signals/opencode/run-capture.mjs
node spikes/s1-host-signals/opencode/analyze.mjs
```

Run one scenario with `node .../run-capture.mjs permission-deny`.

## Scenarios

`permission-allow`, `permission-deny`, `plain-text`, `negative-progress`,
`abort`, `error-invalid-model`, `subagent`.

`negative-progress` is the RF-S1 negative test: an ordinary progress-only turn
must not produce `permission.asked` or a non-empty pending-permission snapshot.
