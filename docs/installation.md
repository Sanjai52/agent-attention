# Installation Guide

Status: OpenCode and Claude Code local installation paths are available. Release
artifacts are produced from tags; clean-profile verification remains a release
gate. See [`compatibility.md`](compatibility.md) for the supported matrix.
Source of truth: `PRD.md` §7.1, §18.4.

## Supported local installation

1. Requirements: Windows 10/11 and Node 24.20+, without administrator rights.
2. Register the per-user Windows notification identity:
   `agent-attention install --host windows`.
   This creates the AUMID registry entry and Start Menu shortcut required for
   unpackaged toast notifications. It is idempotent and does not require admin
   rights. Remove it with `agent-attention uninstall --host windows`.
3. Install Claude Code hooks:
   `agent-attention install --host claude-code --command "agent-attention claude-hook"`.
   Use `--settings <path>` for a temporary or alternate settings file.
4. The installer merges asynchronous command hooks for the verified lifecycle
   signals, backs up an existing settings file, and records an ownership marker.
5. Repeating install is idempotent. Uninstall removes only the exact command
   owned by Agent Attention and preserves user edits:
   `agent-attention uninstall --host claude-code --command "agent-attention claude-hook"`.
6. Verify the host and adapter matrix with `agent-attention doctor --json`.
7. Install the OpenCode plugin through the CLI:
   `agent-attention install --host opencode --config <opencode.jsonc> --plugin <absolute-plugin-directory>`.
   `--config` defaults to the host's configured path; `--state-dir` may be used
   for an isolated profile. Uninstall uses the same host/config options and
   removes only the owned plugin entry.
8. For a release installation, use the CLI tarball produced by the matching
   release tag. Do not run the TypeScript source tree as an installed package;
   published package metadata points to the built `dist/` entrypoints and
   requires Node `>=24.20.0`.
9. The OpenCode adapter is installed as the host-native plugin directory from
   the release bundle. Keep the adapter and OpenCode host within the declared
   range in [`compatibility.md`](compatibility.md); the adapter capabilities
   expose that range for the host/version diagnostic path.
