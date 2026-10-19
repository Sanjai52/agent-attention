# S1 — Host Signals

Scaffold created by Task 0.1; populated by Tasks 0.2–0.5.

- Results: [`../../docs/spikes/s1-results.md`](../../docs/spikes/s1-results.md)
- Matrix: [`../../docs/host-signal-matrix.md`](../../docs/host-signal-matrix.md)

## Question answered

For each candidate host — OpenCode, Claude Code, Codex, Gemini CLI — which of the
11 PRD §16.1 criteria are backed by authoritative evidence: an official
documentation reference or a working Windows capture? Which host has the highest
count of authoritative signals among {approval, resolution, turn boundary,
completion, failure} and therefore becomes D-01?

### Evidence standard

A matrix cell clears `TBD` with `[Verified]` evidence: an official documentation
URL with access date, or a capture path with a line reference. Documentation-only
evidence is valid; for example, `Stability` can only be established from docs.
Community examples or undocumented claims are `[Assumption]` and do not score.

## Time box

| Task | Host | Box |
|---|---|---|
| 0.2 | OpenCode | 2 days |
| 0.3 | Claude Code | 1.5 days |
| 0.4 | Codex or Gemini CLI — whichever has a documented, Windows-native mechanism (or record `unsupported` with evidence) | 1 day |
| 0.5 | Scorecard, D-01, fixtures | No separate box — score only the evidence captured by Tasks 0.2–0.4 |

Stop at the box, record the partial result, and escalate. Do not extend a spike to
make a host look better.

## Method

1. Collect official documentation first. Record the exact URL, doc version, access
   date, and the section relied on in a doc-only record. A signal supported only
   by community examples is `[Assumption]` and cannot score.
2. Build a throwaway probe under `opencode/`, `claude-code/`, or `codex/` or
   `gemini-cli/` using only documented plugin or hook mechanisms. The probe logs
   every lifecycle/hook payload it receives to JSONL.
3. Run the three capture sessions for each verified host: (a) a permission
   request approved and one denied, (b) a turn that ends in plain text, (c) a
   session that errors or is aborted.
4. Negative-test each runtime signal (RF-S1): ordinary progress output must not
   fire the permission/question signal.
5. Record whether the host waits for the probe and for how long, cold and warm.
6. Fill the host's matrix column, citing a doc URL + access date or a capture path
   + line for every non-`TBD` cell. Documentation-only evidence is valid; for
   example, `Stability` can only be established from docs.

## How to reproduce

Exact commands per host are recorded in each capture record in
`docs/spikes/s1-results.md`; doc-only records cite the URL and section instead.
This README does not substitute for them. In general:

1. Install the recorded host version on the recorded Windows build.
2. Register the probe from `<host>/` in a throwaway profile or settings file —
   never the user's live configuration without a backup.
3. Run the recorded capture session and let the probe write to
   `out/<host>/<session>.jsonl` (gitignored).
4. For a capture record, inspect the JSONL to confirm every payload field claimed
   in the matrix. For a doc-only record, re-open the cited URL and section and
   confirm the quoted excerpt.
5. Repeat the negative test on a plain progress-only turn.

## Outputs

- `docs/spikes/s1-results.md` — one evidence record per experiment.
- `docs/host-signal-matrix.md` — host columns and citations.
- `out/<host>/*.jsonl` — raw captures (gitignored; cited, not committed).
- `tests/fixtures/<host>/` — frozen fixtures for the chosen host (Task 0.5).

## Throwaway code — do not promote

The probe plugins and hook scripts exist only to collect evidence. They must not
be imported by or copied into production adapters; those are written from scratch
against PRD §12–§14.
