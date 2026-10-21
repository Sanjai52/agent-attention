# Adapter Development Guide

Status: active guide for the OpenCode and Claude Code adapters. Source of truth:
`PRD.md` §9.2, §16, §17, §18.4.

## Guide

1. An adapter only discovers host signals, normalizes them, declares capabilities,
   and sends contract events. It does not own policy, SQLite, templates, or
   permissions.
2. OpenCode uses an in-process plugin; Claude Code uses asynchronous hook
   commands through the shared shim. Hook commands must never block the host.
3. Every supported event needs a source signal and evidence. `unsupported` is
   preferable to an inferred claim that cannot be measured.
4. Normalized events contain bounded IDs and enumerated details only. Prompts,
   commands, tool inputs, model output, and arbitrary host payloads are dropped.
5. Recorded fixtures are the CI gate. Live smoke is manual and must record
   version, hook names, session IDs, and capability mismatches without secrets.
6. Installers merge only their own hook/plugin entries, create backups before
   modification, are idempotent, preserve user edits, and uninstall only the
   exact entries they own.
7. A host upgrade that changes payloads requires fixture replay and capability
   downgrade until new evidence is recorded.
8. OpenCode is the in-process reference; Claude Code is the hook-process
   example. See the Phase 3/5 progress reports and host signal matrix.
