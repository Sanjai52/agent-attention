# S2 — Process Model and Persistence Results

Status: scaffold created by Task 0.1. Records are appended by Tasks 0.6–0.7.

Scope: measured behavior of the Notification Host, named pipe, shim, spool,
single-instance and idle-exit mechanisms, plus the SQLite binding comparison.

- Spike workspace: [`../../spikes/s2-process-model/README.md`](../../spikes/s2-process-model/README.md)
- Ratified model: [`../architecture.md`](../architecture.md) and PRD §9.2
- Raw captures: `spikes/s2-process-model/out/` (gitignored)

## Evidence record format

Every experiment uses this record, including failed prototypes:

```markdown
## <experiment id> — <question>
- Date / Windows build / tool versions:
- Method (exact command or script path):
- Raw observation (verbatim output excerpt):
- Conclusion:
- Tag: [Verified] | [Assumption] | [Rejected]
```

## Recording rules

- **ID:** `S2-01`, `S2-02`, … sequential in the order recorded; never renumber.
- **Date / versions:** `YYYY-MM-DD`; the Windows build reported by `winver` or
  `[System.Environment]::OSVersion.Version`; Node version, package versions, and
  whether build tools were installed.
- **Method:** the exact command line or script path, with arguments and working
  directory, enough to rerun the experiment. A README link alone is not enough.
- **Raw observation:** a verbatim excerpt, not a paraphrase. Cite the capture
  path and line range. For latency, report the sample count and p50/p95, not a
  single best run; state whether the path was cold or warm. Redact tokens and
  credentials.
- **Conclusion:** answer the question and state any limit on the conclusion.
- **Tag:** exactly one of:
  - `[Verified]` — reproduced locally on the recorded Windows build and tool
    versions with the recorded method.
  - `[Assumption]` — expected but not measured, or supported only by
    documentation or community examples.
  - `[Rejected]` — tested and failed, or contradicted by measurement. Keep the
    record; do not delete a rejected route.

## Required evidence checklist

| Task | Area | Required evidence | Status |
|---|---|---|---|
| 0.6 | Process model | Pipe ACL check; single-instance double start; shim success and failure path; no-console spawn; cold and warm shim overhead (p50/p95, n); receipt-to-dispatch latency; host cold start; spool-to-ingest order; idle exit; crash recovery; D-03 input | Pending |
| 0.7 | SQLite | `node:sqlite` vs `better-sqlite3` on Node 24; WAL, transactions, unique-constraint violation; clean `npm ci` without build tools; unpackaged per-user install without admin; second-process lock behavior; chosen package and version; D-04 input | Pending |

## Records

No records yet. Append records below in task order and update the checklist
status.
