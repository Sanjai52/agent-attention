# Compatibility Matrix

Status: Phase 6 packaging and compatibility baseline is integrated into `main`;
release-tag verification remains pending. This file is copied into each tag
release and must be updated when a host, adapter, Windows, or Node support
range changes.

## Runtime baseline

| Component                | Supported range                    | Evidence / notes                                                                               |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Windows                  | Windows 10/11, native user session | No administrator rights required; WSL, SSH, containers, and remote workspaces are unsupported. |
| Node.js                  | `>=24.20.0`                        | Required by the built-in `node:sqlite` persistence path and all published packages.            |
| npm                      | npm bundled with Node 24           | `npm ci` is the reproducible install command; `package-lock.json` is authoritative.            |
| Agent Attention packages | `0.0.x` Phase 6 baseline           | Package versions and adapter protocol versions are kept in lockstep for this release line.     |

## Host and adapter matrix

| Host        | Host version range | Adapter package                        | Adapter version | Install format                          | Support                                                                                                |
| ----------- | ------------------ | -------------------------------------- | --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| OpenCode    | `>=2.0.32 <2.1.0`  | `@agent-attention/adapter-opencode`    | `0.0.0`         | Host-native local plugin directory      | Supported; capability-gated against OpenCode `v2.0.32`.                                                |
| Claude Code | `>=2.1.181 <3.0.0` | `@agent-attention/adapter-claude-code` | `0.0.0`         | npm package / asynchronous hook command | Supported for the declared hook lifecycle; successful completion and general input remain unsupported. |
| Codex CLI   | —                  | `@agent-attention/adapter-codex`       | `0.0.0`         | Not published for this release          | Not implemented.                                                                                       |
| Gemini CLI  | —                  | `@agent-attention/adapter-gemini-cli`  | `0.0.0`         | Not published for this release          | Not evaluated or implemented.                                                                          |

## Version gates

Adapters advertise `hostVersionRange` in their capabilities. An adapter must
not claim host signals outside that range. OpenCode currently exposes
`>=2.0.32 <2.1.0`; Claude Code exposes `>=2.1.181 <3.0.0`. The CLI/host
diagnostic and release documentation must report the host and declared range
together when a mismatch is detected.

## Release verification

Every release tag runs `npm ci`, the full `npm run ci` suite, and `npm pack` for
the publishable workspaces. The release also contains the OpenCode host-native
plugin archive and this matrix. A clean-profile install and live smoke test are
required before calling the release verified; the workflow produces artifacts,
but does not replace that machine-level evidence.
