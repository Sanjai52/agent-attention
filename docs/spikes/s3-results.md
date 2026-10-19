# S3 — Windows Delivery Results

Status: scaffold created by Task 0.1. Records are appended by Tasks 0.8–0.12.

Scope: measured Windows behavior of audio, TTS, toast, and focus mechanisms,
including unpackaged registration, suppression, and focus restoration. Produces
the Q-05/Q-06/Q-07 answers and the F13 feasibility decision.

- Spike workspace: [`../../spikes/s3-windows-delivery/README.md`](../../spikes/s3-windows-delivery/README.md)
- Decisions: PRD §10, §23.1, §23.2
- Raw captures: `spikes/s3-windows-delivery/out/` (gitignored)

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

- **ID:** `S3-01`, `S3-02`, … sequential in the order recorded; never renumber.
- **Date / versions:** `YYYY-MM-DD`; the Windows build reported by `winver` or
  `[System.Environment]::OSVersion.Version`; PowerShell, Node, and provider
  versions; whether the run was interactive or had the invoking terminal closed.
- **Method:** the exact command line or script path, with arguments and working
  directory, enough to rerun the experiment. A README link alone is not enough.
- **Raw observation:** a verbatim excerpt, not a paraphrase. Cite the capture
  path and line range. For latency, report the sample count and cold/warm state;
  for suppression, report what the API returned versus what the user saw.
  Redact tokens, usernames, and credentials.
- **Conclusion:** answer the question and state any limit on the conclusion.
- **Tag:** exactly one of:
  - `[Verified]` — reproduced locally on the recorded Windows build and tool
    versions with the recorded method, including the terminal-closed run (RF-S3).
  - `[Assumption]` — expected but not measured, or supported only by
    documentation or community examples.
  - `[Rejected]` — tested and failed, or contradicted by measurement. Keep the
    record; do not delete a rejected route.

## Required evidence checklist

| Task | Area | Required evidence | Status |
|---|---|---|---|
| 0.8 | Audio | At least two routes; cold and warm first-play latency; no audio device; missing file; AV/EDR observation; terminal-closed run; proof that no event text reaches the command line | Pending |
| 0.9 | TTS | Text delivered via stdin; voice enumeration; rate and volume control; hostile-string test; no voice installed; time-to-first-audio; cancellation; terminal-closed run | Pending |
| 0.10 | Toast | Per-user registration without admin; every registry key and file documented for uninstall; markup escaping; Focus Assist / Do Not Disturb and disabled-notification states; submitted vs seen; terminal-closed run; second Windows build if available | Pending |
| 0.11 | Focus | Foreground-window detection on Windows Terminal, VS Code, and a classic console host; false positives/negatives; click-to-focus without synthesized input; Q-06 and Q-07 answers | Pending |
| 0.12 | Provider selection | Selection matrix against the PRD §10 criteria; Q-05 decision and rationale | Pending |

## Records

No records yet. Append records below in task order and update the checklist
status.
