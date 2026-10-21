# Phase 6.1 Security Review and Injection Matrix

Status: reviewed on 2026-10-21 against the `phase-6-hardening-release` worktree.

Scope: PRD §17.1–§17.5, with particular attention to RF1. The executable
matrix is [`tests/unit/security/injection-matrix.test.ts`](../tests/unit/security/injection-matrix.test.ts).

## Executive result

The reviewed delivery paths do not interpolate event-derived text into a shell
command, PowerShell source, toast markup, or an executable action. Hostile
agent/project names are either validated/rejected at the event boundary or
sanitized by the fixed presentation templates. TTS and toast payloads are sent
over UTF-8 stdin; sound paths are passed as one argv element after extension,
size, readability, and file checks.

No concrete injection defect was found. The accepted MVP risk remains that a
different process running as the same Windows user can connect to the named
pipe and submit a syntactically valid spoofed event. Such an event can cause a
notification and history entry, but cannot approve, reject, execute, or alter
an agent operation.

## Input × sink matrix

The test runs each vector below through every applicable sink:

| Vector                                          | Toast XML                      | TTS stdin                                       | Sound args                            | History JSON                | Human CLI output                               | Log/diagnostic text                              |
| ----------------------------------------------- | ------------------------------ | ----------------------------------------------- | ------------------------------------- | --------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| Quotes, semicolon, backticks, `$()` and `%VAR%` | Escaped text; no markup        | Stdin only; not argv                            | One fallback path argv; no event name | JSON encoded                | Data text only                                 | No persistent log sink; bounded diagnostics only |
| XML tags and entities                           | Escaped by `escapeXml`         | Stdin only                                      | Not accepted as event-derived input   | JSON encoded                | Data text only                                 | No persistent log sink                           |
| C0/C1 controls and bidi overrides               | Removed before XML             | Removed by name sanitization/template rendering | Not accepted as event-derived input   | JSON encoding remains valid | No structured output corruption from names     | No persistent log sink                           |
| 10,000-character name                           | Sanitized/truncated before XML | Template output is bounded; stdin only          | Not accepted as event-derived input   | JSON encoded                | JSON/text serialization remains non-executable | No persistent log sink                           |

The sound sink has no project/agent-name input by design. The matrix also
checks a hostile custom sound path: it remains a single argument and is never
passed through a shell. The fixed sound script uses a non-shell WinMM API and
validates the path as a file.

## Trust-boundary review

| PRD area                    | Result                          | Evidence                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §17.1 Adapter/host boundary | ok                              | `parseAgentEvent` uses strict Zod schemas; unsupported fields/types are rejected. Connection binding rejects an adapter submitting another adapter's event.                                                                                      |
| §17.1 IPC framing           | ok                              | `parseIpcLine` validates JSON/envelope/payload and rejects lines over 256 KiB. Connections require a hello or bind the first hook event and enforce a hello timeout.                                                                             |
| §17.1 Pipe ACL              | ok, Windows runtime path        | `hardenNamedPipeAcl` applies protected DACL `D:P(A;;FA;;;SY)(A;;FA;;;OW)`, reads it back, and host readiness fails on mismatch. `tests/unit/platform-windows/pipe-acl.test.ts` covers the hardening contract.                                    |
| §17.1 Cross-user access     | ok by design                    | Pipe name is SID-derived and the protected DACL grants SYSTEM and owner only. A second Windows build/clean-profile verification remains Phase 6.2 evidence.                                                                                      |
| §17.2 Command execution     | ok                              | `createFixedScriptRunner` uses `spawn(command, args, { shell: false by default })`; scripts and event text are separate from command arguments. No event payload is executed.                                                                    |
| §17.2 Toast markup          | ok                              | `escapeXml` removes invalid XML characters and escapes all five XML metacharacters; toast XML is sent through stdin.                                                                                                                             |
| §17.2 TTS                   | ok                              | `speak.ps1` reads UTF-8 stdin; speech text is never interpolated into PowerShell or argv. Voice/rate/volume are typed/clamped parameters.                                                                                                        |
| §17.2 Sound                 | ok                              | Custom files require `.wav`/`.mp3`, regular-file/readability checks, and a 5 MiB limit. Script invocation receives a separate path argument.                                                                                                     |
| §17.3 Display/speech names  | ok                              | Strict name validation rejects controls/bidi overrides and names over 64 code points; rendering sanitizes again. Voice requires the documented Unicode allowlist and falls back to discreet speech.                                              |
| §17.4 Payload minimization  | ok                              | The event contract contains enumerated details rather than command/tool payloads. Fixed templates produce user-visible text.                                                                                                                     |
| §17.4 History/CLI           | ok                              | History uses structured fields and JSON serialization; human output contains event metadata only. The matrix verifies hostile values remain data.                                                                                                |
| §17.4 Logs                  | accepted-risk / limited surface | There is no persistent application log sink. Bounded in-memory diagnostics may contain validation/provider messages; they are not executed or emitted as toast/TTS. Future persistent logging must define redaction rules before implementation. |
| §17.5 Least privilege       | ok by design                    | Install and toast registration target per-user HKCU/Start Menu locations; no administrator-only operation is required by the implementation. Clean-profile confirmation belongs to 6.2.                                                          |
| §17.5 Provider isolation    | ok                              | Provider failures map to typed results and dispatch catches failures; event persistence is independent of delivery.                                                                                                                              |

## Same-user spoof scenario (D-15)

The pipe is intentionally a same-user trust boundary for the MVP. A same-user
process that knows the SID-derived pipe name can submit a valid event. The
server validates the envelope, event schema, adapter binding, capabilities,
ordering, deduplication, and policy before persistence/dispatch.

Result: spoofing can create a false alert/history record, but there is no
command, approval, rejection, focus-input, or agent-control operation exposed
by the IPC contract. Cross-user access is denied by the hardened DACL. This is
an accepted risk recorded by PRD decision D-15, not a release-blocking defect.

## Residual evidence

- The matrix is deterministic and runs in unit-test CI; it does not invoke real
  Windows toast/TTS/audio devices.
- Phase 6.2 must still verify the ACL and install/uninstall behavior on a clean
  Windows profile and a second Windows build.
- If persistent logs are added later, repeat this review with explicit redaction
  assertions for every event-derived field.
