# S1 — Host Signal Results

Status: scaffold created by Task 0.1. Records are appended by Tasks 0.2–0.5.

Scope: per-host verification of the PRD §16.1 criteria for OpenCode, Claude Code,
Codex, and Gemini CLI, and the evidence behind D-01.

- Matrix: [`../host-signal-matrix.md`](../host-signal-matrix.md)
- Spike workspace: [`../../spikes/s1-host-signals/README.md`](../../spikes/s1-host-signals/README.md)
- Raw captures: `spikes/s1-host-signals/out/<host>/*.jsonl` (gitignored)
- Official docs: URL, access date, and section are recorded in each doc-only record

## Evidence record format

Every experiment uses this record, including negative tests:

```markdown
## <experiment id> — <question>
- Date / Windows build / tool versions:
- Method (exact command or script path):
- Raw observation (verbatim output excerpt):
- Conclusion:
- Tag: [Verified] | [Assumption] | [Rejected]
```

## Recording rules

- **ID:** `S1-01`, `S1-02`, … sequential in the order recorded; never renumber.
- **Date / versions:** `YYYY-MM-DD`; the Windows build reported by `winver` or
  `[System.Environment]::OSVersion.Version`; host CLI version; Node version if a
  probe used it. For a doc-only record, give the access date and write
  `n/a (doc-only)` for the Windows build and tool versions.
- **Method:** for a capture, the exact command line or script path, with
  arguments and working directory, enough to rerun the experiment. For a
  doc-only record, the official documentation URL and the section heading relied
  on. A README link alone is not enough.
- **Raw observation:** a verbatim excerpt, not a paraphrase. For a capture, quote
  the output and cite the capture path and line range
  (`out/opencode/permission.jsonl:12-18`); captures are gitignored, so the
  excerpt is the durable evidence. For a doc-only record, quote the relied-on
  documentation text verbatim and name its section. Redact tokens, usernames,
  and credentials.
- **Conclusion:** answer the question and state any limit on the conclusion.
  For a runtime signal, record the RF-S1 negative test that shows ordinary
  progress does not fire it. Documentation-based criteria such as `Stability`
  are concluded from the quoted section.
- **Tag:** exactly one of:
  - `[Verified]` — supported by an official documentation URL with access date,
    or reproduced locally on the recorded Windows build and host version with a
    capture path and line reference. Documentation-only evidence is valid; for
    example, `Stability` can only be established from docs. Only this tag may
    clear `TBD` from a matrix cell.
  - `[Assumption]` — community examples or undocumented claims. Cannot clear a
    matrix cell.
  - `[Rejected]` — tested and failed, or contradicted by measurement. Keep the
    record; do not delete a rejected route.

## Required evidence checklist

| Task | Area | Required evidence | Status |
|---|---|---|---|
| 0.2 | OpenCode | Official docs (URLs + access dates); approved and denied permission captures; plain-text turn end; error/abort; negative test; matrix column | Pending |
| 0.3 | Claude Code | Hook docs and payload fields; the same three sessions plus a session-end hook if one exists; cold/warm hook runtime and whether the host waits; negative test; matrix column | Pending |
| 0.4 | Third host (Codex or Gemini CLI) | Documented mechanism, or documented `unsupported` with evidence; permission and turn-end captures where available; negative test; matrix column | Pending |
| 0.5 | Scorecard / D-01 | Authoritative count for {approval, resolution, turn boundary, completion, failure}; tie-breaker; winner; fixture paths | Pending |

## Records

No records yet. Append records below in task order and update the checklist
status.
