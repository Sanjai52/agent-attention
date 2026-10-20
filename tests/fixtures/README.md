# Fixtures

Recorded and synthetic event streams used by adapter and core tests (PRD §19.1).
Fixtures never contain free text from an agent: only the validated `AgentEvent`
contract and a final session snapshot.

- `synthetic/` — hand-written streams (Phase 1).
- `<host>/` — streams recorded from real host sessions (Phase 3, after D-01).

## JSONL format

One JSON object per line. Blank lines and lines starting with `#` are ignored.

1. **Exactly one `meta` line, first.**
   ```json
   {"kind":"meta","name":"basic-session","host":"synthetic","recordedAt":"2026-10-20T10:00:00Z","hostVersion":"0.0.0"}
   ```
2. **`event` lines**, wrapping a complete contract event. Each event is
   validated with `parseAgentEvent` while loading; an invalid event fails the
   fixture with its line number and validation path.
   ```json
   {"kind":"event","event":{"schemaVersion":1,"eventId":"basic-1","eventIdStability":"source","eventType":"agent.started","source":{"adapterId":"synthetic","adapterVersion":"1.0.0","agentId":"synthetic-agent","agentName":"Agent A"},"session":{"sessionId":"session-1"},"occurredAt":"2026-10-20T10:00:00Z","receivedAt":"2026-10-20T10:00:00Z","confidence":"authoritative"}}
   ```
3. **`expected` lines** with the final normalized session state. Replay fails
   with a readable diff if the snapshot does not match.
   ```json
   {"kind":"expected","adapterId":"synthetic","sessionId":"session-1","state":"completed","stateConfidence":"authoritative"}
   ```

## Synthetic streams

| Fixture | Flow | Expected |
|---|---|---|
| `synthetic/basic-session.jsonl` | started → progress → needs_input → resumed → completed | `completed`, authoritative, no pending requests |

## Loading and replay

`tests/helpers/fixtures.ts` exposes:

- `loadFixture(name)` — loads relative to `tests/fixtures/`.
- `parseFixture(text, name)` — validates JSONL without touching the filesystem.
- `replayFixture(stream, deps)` — replays every event through the real
  pipeline, verifies expected snapshots, and returns notifications/statuses.

Replay is deterministic because the clock, rate limiter, quiet-hours minutes,
and `PipelineStore` are injected. Replaying the same stream against the same
store must not re-deliver notifications; the second pass is deduplicated.

## Recording real-host fixtures

Phase 3 additions must record the host/version, capture date, and the raw
adapter payload alongside the normalized events. Do not edit a recorded stream
by hand to make a test pass; add a synthetic fixture for the edge case instead.
