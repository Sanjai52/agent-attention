# S2 — Process Model and Persistence

Scaffold created by Task 0.1; populated by Tasks 0.6–0.7.

- Results: [`../../docs/spikes/s2-results.md`](../../docs/spikes/s2-results.md)
- Ratified model: [`../../docs/architecture.md`](../../docs/architecture.md) and PRD §9.2

## Question answered

1. Can the PRD §9.2 process model be built on Windows: per-user named pipe
   (`\\.\pipe\agent-attention-<user>`), single instance, detached shim, spool
   fallback, idle exit, and crash recovery?
2. Does hook-shim overhead meet the PRD §19.3 targets — p95 < 300 ms and a 1000 ms
   hard cap — when cold start is measured separately from the warm path?
3. Which SQLite binding ships unpackaged on Node 24 — `node:sqlite` (built-in) or
   `better-sqlite3` (native) — and under what install and native-build
   constraints? (D-04)

## Time box

| Task | Area | Box |
|---|---|---|
| 0.6 | Pipe, single instance, shim, spool, latency, idle exit, crash recovery, D-03 | 2 days |
| 0.7 | SQLite binding A/B and D-04 | 0.5 day |

Stop at the box, record the partial result, and escalate. Do not extend a spike to
make a prototype look better.

## Method

1. Prototype a named-pipe server and client in Node with a server-created security
   descriptor restricted to the current user; attempt a connection as a second
   low-privilege user, or document the check performed.
2. Prototype single instance via exclusive pipe creation and via a named mutex;
   verify a double start leaves exactly one live host.
3. Prototype the shim path: connect → send one event → exit, plus the failure
   path (pipe unreachable → spawn detached hidden → retry once → spool to
   `%LOCALAPPDATA%\AgentAttention\spool\*.jsonl`). Prove no console window appears.
4. Measure cold and warm shim overhead, receipt-to-dispatch latency, host cold
   start, and spool-to-ingest ordering (RF-S2). Compare against PRD §19.3.
5. Prototype idle exit (no live sessions for 10 minutes → graceful shutdown) and
   crash recovery (kill the host mid-write → restart sees a consistent DB).
6. Prototype both SQLite bindings on Node 24 with WAL mode, transactions, and a
   unique-constraint violation surfaced as an error. Test a clean `npm ci` with no
   build tools, unpackaged per-user install, no admin, and behavior when a second
   process holds the DB lock.

## How to reproduce

Exact commands, script paths, and machine state are recorded in each experiment
record in `docs/spikes/s2-results.md`. In general:

1. Install the recorded Node version on the recorded Windows build.
2. Run the prototype command from the recorded working directory; keep stdout,
   stderr, and timing output under `out/` (gitignored).
3. For latency, run the cold path after a reboot or with the host fully stopped;
   report p50/p95 and the sample count, not a single warm run.
4. For the shim failure path, block the pipe, run the shim, then verify the spool
   file and that no console window appeared.
5. For SQLite, repeat the run with a clean profile and no build tools installed.

## Outputs

- `docs/spikes/s2-results.md` — measurements, rejected routes, D-03/D-04 inputs.
- `docs/architecture.md` and PRD §9.2/§23.1 — ratified model and decisions.
- `out/*.jsonl`, `out/*.log`, `out/*.db` — raw captures and measurements
  (gitignored; cited, not committed).

## Throwaway code — do not promote

The pipe, host, shim, spool, and SQLite prototypes exist only to measure the
design. Phase 2 reimplements the accepted model against PRD §12–§14; none of this
code is production-ready and none of it may be promoted wholesale.
