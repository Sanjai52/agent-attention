# S2 — Process Model and Persistence

Scaffold created by Task 0.1; probe and measurements added by Task 0.6.
SQLite binding work (Task 0.7 / D-04) is **not** in this directory yet.

- Results: [`../../docs/spikes/s2-results.md`](../../docs/spikes/s2-results.md)
- Private shard (full evidence): [`../../docs/spikes/phase-0-shards/s2-process.md`](../../docs/spikes/phase-0-shards/s2-process.md)
- Ratified model: [`../../docs/architecture.md`](../../docs/architecture.md) and PRD §9.2

## Question answered

1. Can the PRD §9.2 process model be built on Windows: per-user named pipe
   (`\\.\pipe\agent-attention-<user>`), single instance, detached shim, spool
   fallback, idle exit, and crash recovery?
2. Does hook-shim overhead meet the PRD §19.3 targets — p95 < 300 ms and a 1000 ms
   hard cap — when cold start is measured separately from the warm path?
3. Which SQLite binding ships unpackaged on Node 24 — `node:sqlite` (built-in) or
   `better-sqlite3` (native) — and under what install and native-build
   constraints? (D-04 — **pending, not answered here**)

## Time box

| Task | Area | Box |
|---|---|---|
| 0.6 | Pipe, single instance, shim, spool, latency, idle exit, crash recovery, D-03 | 2 days |
| 0.7 | SQLite binding A/B and D-04 | 0.5 day |

## Prototype layout

| Path | Purpose |
|---|---|
| `lib/paths.mjs` | Pipe name (`\\.\pipe\agent-attention-<user>[-suffix]`) and `%LOCALAPPDATA%\AgentAttention` paths |
| `lib/journal.mjs` | Durable append-only framed journal used **only** for the crash test (CRC32, fsync, torn-tail truncation). Not the production store; D-04 is pending. |
| `host.mjs` | Headless pipe server, single writer, dedupe, receipt→dispatch timing, spool ingest, idle exit, ACL hardening, crash-writer / verify modes |
| `shim.mjs` | Connect → send one event → exit; on failure spawn host detached hidden → retry window → spool |
| `client.mjs` | CLI-shaped pipe client used by the benchmarks |
| `scripts/pipe-acl.ps1` | Read/set/deny a pipe DACL with P/Invoke; used to prove ACL enforcement |
| `scripts/pipe-acl-helper.cs` | Compiled C# ACL helper; demonstrates the fast production route |
| `scripts/read-pipe-dacl.ps1` | Earlier DACL probe (same P/Invoke) |
| `scripts/window-check.ps1` | `AttachConsole` + `GetConsoleWindow` + `EnumWindows` probe for a PID |
| `scripts/console-parent-alloc.ps1` | Allocates a real console, then spawns the host with the shim's flags |
| `scripts/mutex-test.ps1`, `scripts/mutex-contender.ps1` | Named-mutex double-start and owner-kill test |
| `bench/run-measurements.mjs` | Host cold start, warm/cold shim, hardened cold shim, dispatch latency, spool order, idle exit, single instance |
| `bench/acl.mjs` | Default DACL, hardened DACL, deny-ACE control, ACL cost |
| `bench/no-console.mjs` | Detached-spawn window probe with controls |
| `bench/crash-recovery.mjs` | 10× kill -9 mid-write plus deterministic torn-tail cases |

## Exact reproduction commands

Run from `spikes/s2-process-model/`. All generated artifacts land in `out/`
(gitignored).

```bash
# 1. Compile the throwaway ACL helper (only needed for the hardened cold-shim run)
MSYS_NO_PATHCONV=1 C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe \
  /nologo /optimize+ /target:exe "/out:out\bin\pipe-acl-helper.exe" \
  "scripts\pipe-acl-helper.cs"

# 2. Main measurements (~45 s)
node bench/run-measurements.mjs

# 3. DACL readback, hardening, deny-ACE enforcement, cross-user limitation
node bench/acl.mjs

# 4. Detached-spawn console probe (opens and closes a real console briefly)
node bench/no-console.mjs

# 5. Named mutex double-start / owner kill
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mutex-test.ps1

# 6. Crash recovery: 10 kill -9 runs + torn tail
node bench/crash-recovery.mjs
```

A single shim can be exercised by hand:

```bash
# host running
node host.mjs --pipe-suffix demo --data-root out/demo --log out/demo/host.jsonl --idle-ms 600000
node shim.mjs --pipe-suffix demo --data-root out/demo --metrics-dir out/demo/m --seq 1

# pipe unreachable -> detached spawn -> retry -> event on the pipe
node shim.mjs --pipe-suffix demo2 --data-root out/demo2 --metrics-dir out/demo2/m --seq 1

# pipe unreachable and spawning disabled -> spool
node shim.mjs --pipe-suffix demo3 --data-root out/demo3 --no-spawn --seq 1
```

## Measured results (2026-10-20, Windows build 26300, Node v24.20.0)

| Measurement | n | p50 | p95 | Target | Tag |
|---|---:|---:|---:|---|---|
| Host cold start (spawn→first ping) | 10 | 85.7 ms | 101.1 ms | none | [Verified] |
| Warm shim, external spawn→exit | 100 | 114.4 ms | 137.9 ms | p95 < 300 ms | [Verified] |
| Warm shim, internal logic only | 100 | 10.4 ms | 12.5 ms | — | [Verified] |
| Cold shim (host absent, spawn+send) | 10 | 221.2 ms | 239.8 ms | < 1000 ms cap | [Verified] |
| Cold shim + compiled ACL helper | 5 | 277.0 ms | 300.1 ms | < 1000 ms cap | [Verified] |
| Receipt→dispatch (incl. journal fsync) | 500 | 2.31 ms | 2.64 ms | p95 < 500 ms | [Verified] |
| Client→ack RTT | 500 | 2.70 ms | 3.30 ms | — | [Verified] |
| Host cold start + PowerShell ACL harden | 5 | 722 ms | 751 ms | cap 1000 ms | [Rejected route] |
| Host cold start + compiled ACL helper | 5 | 146 ms | 229 ms | cap 1000 ms | [Verified] |

Additional verified behavior:

- **Single instance:** second host exits `3` (`already running`); the first PID
  remains the only one answering the pipe.
- **Named mutex:** A `createdNew=true`, B `createdNew=false`, C after killing A
  `createdNew=true`; `Local\` is per-session, so the pipe is the authoritative
  machine-wide guard.
- **Spool order:** 20 sequential shims ingest in sequence order 1…20, spool
  directory empty afterwards. 20 concurrent shims preserve spool filename order
  (file order == ingest order) but not sequence order (4 inversions in the
  recorded run; 21 in an earlier run); per-session `sequence` is authoritative.
- **Idle exit:** shortened to `idle-ms=3000`, `session-live-ms=1000`; one event →
  exit after 4.25 s; 12 events over 6 s → host stays alive, exits 4.14 s after the
  last event.
- **Crash recovery:** 10/10 `taskkill /F` mid-write runs recover contiguous
  journals with no corruption; a deterministic 49-byte torn tail and a 63-byte
  bad-CRC tail are truncated to the last valid record.
- **No console:** the real shim spawn (`detached:true`, `windowsHide:true`,
  `stdio:'ignore'`) produces a process with **no console at all**
  (`AttachConsole` error 6) and zero top-level windows. `windowsHide:true`
  without `detached` produces a console with `GetConsoleWindow()==0`.
  See the shard for the negative-control limitation.

## Limits and things this prototype does not prove

- **True post-reboot cold start was not measured.** Every "cold" number here
  means the host was not running; the OS file cache and Defender were warm.
  Reboot-cold is [Assumption], supported by the large headroom below 1000 ms.
- **No cross-user connection attempt.** A true second-user test needs credentials
  for another account or admin rights to create one; this session is
  non-elevated. The DACL was read back and an explicit deny ACE was proven to
  block a connect, but that is not the same as authenticating as a second user.
- **Node cannot set a pipe DACL at creation.** The default DACL grants
  `Everyone`/`Anonymous` read (not write). Hardening is post-create and has a
  short race window; see the shard.
- **D-04 is untouched.** `lib/journal.mjs` is a durable-file stand-in for the
  crash test, not a recommendation. The SQLite binding decision belongs to
  Task 0.7.
- **The 10-minute idle default was not waited out.** The same code path was run
  with a shortened timer.
- **Hook-to-audible-sound end-to-end (< 2 s)** was not measured; it depends on
  the S3 providers.

## Throwaway code — do not promote

The pipe, host, shim, spool, journal, and ACL helper exist only to measure the
design. Phase 2 reimplements the accepted model against PRD §12–§14; none of this
code is production-ready and none of it may be promoted wholesale. In particular:
no retry/backoff tuning, no input validation beyond the prototype fields, no log
rotation, no graceful handling of every pipe error, and no security review.
