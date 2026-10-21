# Phase 6 performance and storm report

Status: initial evidence integrated into `main`; clean-profile and
release-candidate verification remain pending. Updated 2026-10-22.

## Scope

Task 6.4 exercises the production pipe framing, connection dispatcher, SQLite
event store, SQLite dedupe path, and notification dispatch boundary. Providers
are stubbed so OS sound, speech, and desktop delivery do not dominate the
transport and persistence measurements.

The test uses 50 distinct persisted lifecycle events because the storage
contract intentionally excludes `agent.progress` from history. A separate
`agent.needs_input` event is submitted after the burst to exercise the real
dispatch/provider boundary and measure receipt-to-dispatch latency.

## Method

- Platform: Windows only; the named-pipe suite is skipped on non-Windows hosts.
- Runtime: the repository's supported Node.js runtime and Vitest harness.
- Persistence: a temporary on-disk SQLite database opened with WAL mode and a
  1,000 ms busy timeout.
- Transport: a real Windows named pipe, one adapter handshake, and concurrent
  IPC submissions.
- Load: 50 persisted lifecycle events, submitted concurrently as a 50
  events/second target burst, followed by one controlled alert event.
- Assertions: all acknowledgements succeed, all 50 storm events plus the
  controlled alert are persisted, and receipt-to-dispatch remains below the
  500 ms p95 target.
- Replay: the first half of a storm is persisted, the pipe/store are closed,
  the store is reopened, and all 50 event IDs are replayed. SQLite dedupe must
  leave exactly 50 event rows.

## Measurements

The exact numbers are printed by the focused test as a `[performance]` line.
The initial Phase 6 run below was executed on 2026-10-21.

| Measurement                  |                 Target |                                         Result | Status     |
| ---------------------------- | ---------------------: | ---------------------------------------------: | ---------- |
| Storm size                   |              50 events |                                             50 | measured   |
| Target input rate            |            50 events/s |                                 50-event burst | measured   |
| Receipt-to-dispatch p95      |               < 500 ms |                                        4.31 ms | pass       |
| Storm wall-clock burst       |                      — |                                       28.85 ms | measured   |
| Storm persistence            |  50/50 rows (+1 alert) |                                     51/51 rows | pass       |
| Replay dedupe                |         50 unique rows |                                 50 unique rows | pass       |
| Shim overhead p95            | < 300 ms; 1,000 ms cap |                      not measured by this test | gap        |
| Hook-to-audible p95          |                  < 2 s |       not measured; provider overhead excluded | gap        |
| Mid-storm `kill -9` recovery |           exactly once | not performed; graceful restart/replay covered | limitation |

## Interpretation and limitations

This evidence establishes the real pipe/SQLite ingestion path under a small
burst, verifies persistence plus replay dedupe, and measures one controlled
dispatch through stubbed providers. It does not establish
cross-machine performance, a clean-VM result, short-lived shim process
overhead, or real SAPI/audio latency.

The restart test deliberately closes the in-process server and database rather
than sending `kill -9` to a separate host process. It proves the persistent
dedupe behavior after reopening, but it cannot prove OS-level crash semantics,
spool preservation, or the exact set of dispatches that were in flight at the
moment of termination. Those remain release evidence items.

The current test uses persisted lifecycle events for the storm and only one
audible alert, so it does not claim the rate-limit contract's behavior under an
audible alert storm or one-summary behavior. A separate alert storm with
provider timing must be recorded before the PRD §19.3 audible metrics can be
marked complete.
