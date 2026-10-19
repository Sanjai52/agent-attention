# Feasibility Spikes (Phase 0)

Throwaway prototypes that prove or reject the assumptions blocking implementation.
Every experiment is recorded in [`../docs/spikes/`](../docs/spikes/) using the
evidence-record format; the host comparison lands in
[`../docs/host-signal-matrix.md`](../docs/host-signal-matrix.md).

> **Throwaway code — do not promote.** Nothing under `spikes/` may be imported,
> copied, or promoted into `packages/` or `adapters/`. Production code is written
> against PRD §12–§14 after Phase 0; spike code exists only as evidence.

## Questions answered

| Spike | Directory | Question | Results |
|---|---|---|---|
| **S1 — Host signals** | [`s1-host-signals/`](./s1-host-signals/README.md) | Which candidate host exposes authoritative approval, resolution, turn-boundary, completion, and failure signals on Windows? | [`../docs/spikes/s1-results.md`](../docs/spikes/s1-results.md) |
| **S2 — Process model** | [`s2-process-model/`](./s2-process-model/README.md) | Can the pipe/host/shim/spool model meet the latency and single-instance requirements, and which SQLite binding ships unpackaged? | [`../docs/spikes/s2-results.md`](../docs/spikes/s2-results.md) |
| **S3 — Windows delivery** | [`s3-windows-delivery/`](./s3-windows-delivery/README.md) | Which audio, TTS, toast, and focus mechanisms work natively, unpackaged, and without blocking the host? | [`../docs/spikes/s3-results.md`](../docs/spikes/s3-results.md) |

## Time box

| Spike | Box | Plan tasks |
|---|---|---|
| S1 — Host signals | 4.5 days of captures plus scoring (no separate scoring box) | 0.2–0.5 |
| S2 — Process model | 2.5 days | 0.6–0.7 |
| S3 — Windows delivery | 3 days | 0.8–0.12 |

Stop at the box, record the partial result and the unanswered question, and
escalate to the Phase 0 exit review (Task 0.13) rather than overrunning.

## Method

Each spike follows the same evidence loop:

1. Collect official documentation before running anything; record the exact URL,
   doc version, and access date.
2. Build the smallest throwaway probe that can produce — or fail to produce — the
   signal or measurement in question.
3. Capture raw payloads, timings, and output under `out/`; negative-test every
   candidate signal so ordinary activity is proven not to fire it.
4. Record each experiment in `docs/spikes/<s>-results.md`; score only
   `[Verified]` evidence.

Spike-specific methods are in each directory README.

## How to reproduce

The exact command for each experiment is in its result record; this README does
not substitute for it. In general:

1. Match the recorded Windows build and the recorded host/tool versions.
2. Run the spike from its own directory and keep captures in `out/` (gitignored).
3. Compare the observed payload or timing with the claim in the result record and
   the matrix; if they differ, correct the record, not the observation.
4. For delivery spikes, re-run with the invoking terminal closed (RF-S3).

## Evidence rules

- Spike source, scripts, settings fragments, and READMEs are committed.
- Generated captures, logs, temporary databases, and audio files go under
  `spikes/**/out/`, which is gitignored. Do not commit them; cite the path and a
  verbatim excerpt in the result record instead.
- Every record states date, Windows build, tool/host versions, the exact command
  or script path, a raw output excerpt, a conclusion, and exactly one tag:
  `[Verified]`, `[Assumption]`, or `[Rejected]`.
- A matrix cell may leave `TBD` only with `[Verified]` evidence: an official
  documentation URL with access date, or a capture path with a line reference.
  Community examples are `[Assumption]` and do not score.
- Record negative results (a signal that did **not** fire where it should not)
  as evidence, not as a footnote. Deleted or abandoned routes stay in the log as
  `[Rejected]`.

## Throwaway code — do not promote

The prototypes exist only to collect evidence. They must not be imported by or
copied into production packages or adapters; production code is written from
scratch against PRD §12–§14.
