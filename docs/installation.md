# Installation Guide

Status: OpenCode and Claude Code local installation paths are available; clean
profile and release packaging remain Phase 6 work.
Source of truth: `PRD.md` §7.1, §18.4.

## Supported local installation

1. Requirements: Windows 10/11 and Node 24.20+, without administrator rights.
2. Install Claude Code hooks:
   `agent-attention install --host claude-code --command "agent-attention claude-hook"`.
   Use `--settings <path>` for a temporary or alternate settings file.
3. The installer merges asynchronous command hooks for the verified lifecycle
   signals, backs up an existing settings file, and records an ownership marker.
4. Repeating install is idempotent. Uninstall removes only the exact command
   owned by Agent Attention and preserves user edits:
   `agent-attention uninstall --host claude-code --command "agent-attention claude-hook"`.
5. Verify the host and adapter matrix with `agent-attention doctor --json`.
6. Install the OpenCode plugin through the CLI:
   `agent-attention install --host opencode --config <opencode.jsonc> --plugin <absolute-plugin-directory>`.
   `--config` defaults to the host's configured path; `--state-dir` may be used
   for an isolated profile. Uninstall uses the same host/config options and
   removes only the owned plugin entry.
7. Clean-profile install/uninstall, toast registration, packaging, and the final
   compatibility matrix are Phase 6 release gates.
