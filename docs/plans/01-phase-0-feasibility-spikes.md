# Phase 0 — Feasibility Spikes Implementation Plan

> **Status: COMPLETE (2026-10-20).** All tasks were executed or explicitly
> recorded as blocked with evidence. Checked steps mean "executed or documented
> as blocked"; see `docs/phase-0.md` and the result logs for limitations. The
> remaining unverified items are listed in `docs/spikes/s1-results.md`,
> `s2-results.md`, `s3-results.md`, and PRD §23.2.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every `[Assumption]` in `PRD.md` that blocks implementation with `[Verified]` evidence or a documented decision, producing `docs/host-signal-matrix.md`, the D-01/D-03/D-04 decisions, and Q-05/Q-06/Q-07 answers.

**Architecture:** Three time-boxed spikes (S1 host signals, S2 process model + storage, S3 Windows delivery) run against throwaway prototypes in `spikes/`. Spike code is throwaway: it MUST NOT be promoted to production without a rewrite against PRD §12–§14 (PRD M0 exit criteria).

**Tech Stack:** Node.js 24 (installed), TypeScript for prototypes via `tsx`, Windows 10/11 host machine, official host documentation, PowerShell 5.1 for OS-native experiments.

**Spec:** `PRD.md` §4.3, §9.2, §10, §16.1, §19.3, §20 (M0), §23.

## Global Constraints

- Windows 10/11 only for spikes; WSL/SSH/container behavior is out of scope except as `doctor`-detectable conditions.
- Every spike result is recorded with: date, Windows build, relevant host/library versions, exact commands or script paths, raw output, and a **[Verified]** / **[Assumption]** tag.
- Spike code lives under `spikes/<s1|s2|s3>-<name>/` and is committed for evidence; generated captures live under `spikes/**/out/` (gitignored).
- Decisions land in `PRD.md` §23 and, where architecture-relevant, `docs/architecture.md` in the same change that closes the spike.
- Time-box: 5–7 working days total (PRD M0). Each task below notes its box; if a box is exceeded, stop, record the partial result, and escalate rather than overrun.

## Review Focus

- **RF-S1 — A host signal that looks authoritative but is not.** e.g. a "notification" hook that fires for progress as well as questions. Each candidate signal needs a negative test (ordinary progress must not fire it) before being scored.
- **RF-S2 — Prototype latency measured on a warm path only.** Measure cold start (first event after boot) as well as warm; the shim cap (1000 ms) applies to cold.
- **RF-S3 — PowerShell-based delivery that works interactively but not from a background host.** Every prototype must be re-run with the invoking terminal closed.
- **RF-S4 — Host capture sessions that never exercise the needed border.** A fixture stream is only evidence if the session actually produced that signal.
- **RF-S5 — Spike scope creep.** Anything not answering a §23 open question or §16.1 criterion is out of scope.

---

### Task 0.1: Spike workspace and evidence log

**Files:**
- Create: `spikes/README.md`
- Create: `spikes/s1-host-signals/README.md`, `spikes/s2-process-model/README.md`, `spikes/s3-windows-delivery/README.md`
- Modify: `docs/host-signal-matrix.md` (replace the scaffold with the §16.1 criteria table)
- Create: `docs/spikes/s1-results.md`, `docs/spikes/s2-results.md`, `docs/spikes/s3-results.md`

**Interfaces:**
- Produces: the evidence-log format every later spike task writes into; the matrix table columns that Task 0.5 scores.

- [x] **Step 1: Create the spike directories and READMEs.** Each README states: question answered, time box, method, how to reproduce, and "throwaway code — do not promote".
- [x] **Step 2: Create the three result documents in `docs/spikes/` with this record format:**

```markdown
## <experiment id> — <question>
- Date / Windows build / tool versions:
- Method (exact command or script path):
- Raw observation (verbatim output excerpt):
- Conclusion:
- Tag: [Verified] | [Assumption] | [Rejected]
```

- [x] **Step 3: Populate `docs/host-signal-matrix.md` with the §16.1 criteria as rows** (`Approval signal`, `Resolution signal`, `Blocking input`, `Turn boundary`, `Completion`, `Failure`, `Stable IDs / sequence`, `Subagents`, `Non-blocking`, `Windows-native`, `Stability`) and one column per candidate host (OpenCode, Claude Code, Codex, Gemini CLI), each cell starting as `TBD`.
- [x] **Step 4: Commit** `docs: add phase 0 spike workspace and evidence logs`.

---

### Task 0.2: S1 — verify OpenCode host signals

**Files:**
- Create: `spikes/s1-host-signals/opencode/` (probe plugin scripts)
- Capture: `spikes/s1-host-signals/out/opencode/*.jsonl`
- Modify: `docs/spikes/s1-results.md`, `docs/host-signal-matrix.md`

**Interfaces:**
- Produces: matrix cells + raw captures for the OpenCode column; candidate plugin lifecycle knowledge for Phase 3.

**Time box: 2 days.**

- [x] **Step 1: Collect official documentation.** Record exact URLs, doc versions, and access dates in `s1-results.md`. If a candidate signal exists only in community examples, it is **[Assumption]** and cannot score.
- [x] **Step 2: Build a probe plugin** that logs every plugin lifecycle/hook payload it receives to a JSONL file. Use only documented plugin mechanisms.
- [x] **Step 3: Run three capture sessions** covering: (a) a permission request that is approved and one that is denied, (b) an agent turn that ends in plain text, (c) a session that errors or is aborted.
- [x] **Step 4: Negative-test each candidate signal** (RF-S1): confirm ordinary progress output does not fire the permission/question signals; record the negative result in the matrix note cell.
- [x] **Step 5: Fill the matrix column** answering all 11 criteria, each authoritative row citing a capture line or doc reference.
- [x] **Step 6: Commit** `docs: record opencode signal verification (S1)`.

---

### Task 0.3: S1 — verify Claude Code host signals

**Files:**
- Create: `spikes/s1-host-signals/claude-code/` (hook scripts + settings fragment used only in the spike)
- Capture: `spikes/s1-host-signals/out/claude-code/*.jsonl`
- Modify: `docs/spikes/s1-results.md`, `docs/host-signal-matrix.md`

**Time box: 1.5 days.**

- [x] **Step 1: Collect official hook documentation.** Record which hook events exist (e.g., notification/permission/stop-type hooks), their payload fields, and whether they block the host.
- [x] **Step 2: Register probe hooks** in a throwaway settings file pointing at a logging script; do not modify the user's real configuration except via a backed-up spike profile.
- [x] **Step 3: Capture the same three sessions as Task 0.2 Step 3**, plus a hook that fires on session end if one exists.
- [x] **Step 4: Measure hook runtime** for each probe (cold and warm, RF-S2) and record whether the host waits for the hook.
- [x] **Step 5: Fill the matrix column** with the same citation standard.
- [x] **Step 6: Commit** `docs: record claude code signal verification (S1)`.

---

### Task 0.4: S1 — verify a third host (Codex or Gemini CLI)

**Files:**
- Create: `spikes/s1-host-signals/<chosen-host>/`
- Capture: `spikes/s1-host-signals/out/<chosen-host>/*.jsonl`
- Modify: `docs/spikes/s1-results.md`, `docs/host-signal-matrix.md`

**Interfaces:**
- Consumes: 0.2/0.3 findings to choose the candidate whose documented mechanism exists in the installed version.
- Produces: the third scorecard column; feasibility notes for Phase 5.

**Time box: 1 day.**

- [x] **Step 1: Pick the host** with a documented plugin/extension/hook mechanism that runs natively on Windows; if neither has one, record `unsupported` with evidence and still complete the column.
- [x] **Step 2: Probe, capture, negative-test, and score** the same way as 0.2/0.3, reducing sessions to permission + turn-end if the host lacks signals.
- [x] **Step 3: Commit** `docs: record <host> signal verification (S1)`.

---

### Task 0.5: S1 — scorecard, D-01, and fixtures

**Files:**
- Modify: `docs/host-signal-matrix.md` (add scorecard section), `PRD.md` (§23.1 D-01, §24 change log)
- Create: `tests/fixtures/<chosen-host>/README.md` and raw fixture files for the chosen host
- Modify: `docs/spikes/s1-results.md`

**Interfaces:**
- Produces: **D-01 = first host**, and the raw fixture streams Phase 3 replays.

- [x] **Step 1: Apply the selection rule** (PRD §16.1): highest count of authoritative signals among {approval, resolution, turn boundary, completion, failure}; integration convenience breaks ties. Write the count table and the winner in `s1-results.md`.
- [x] **Step 2: Record D-01 in `PRD.md` §23.1** (status: Decided (S1)) and update §24 change log; also amend §14/§16 for any factual correction the spike produced (e.g., a host does not support inferred `needs_input`, so F1-R9 applies).
- [x] **Step 3: Freeze fixtures.** Copy the chosen host's raw captures into `tests/fixtures/<host>/` with a README stating host version, date, which signals each file contains, and the expected normalized event list for each. Fixture format is finalized in Task 1.17; for now store raw JSONL plus a `expected.md` note.
- [x] **Step 4: Run the Q-01/Q-02/Q-03/Q-08 list** and mark each answered/deferred in `s1-results.md`; unanswered questions stay in PRD §23.2.
- [x] **Step 5: Commit** `docs: decide D-01 first host and record s1 fixtures`.

---

### Task 0.6: S2 — process model prototype (pipe, host, shim, spool)

**Files:**
- Create: `spikes/s2-process-model/` (pipe server/client, detached spawn, spool writer/reader prototypes)
- Capture: `spikes/s2-process-model/out/*.jsonl` (latency measurements)
- Modify: `docs/spikes/s2-results.md`, `docs/architecture.md` (process model section), `PRD.md` (§9.2 ratification + §23.1 D-03)

**Interfaces:**
- Produces: the measured process model that Phase 2 implements; the pipe name scheme `\\.\pipe\agent-attention-<user>`; single-instance mechanism; shim time budget.

**Time box: 2 days.**

- [x] **Step 1: Prototype a named-pipe server and client in Node** with a server-created security descriptor restricted to the current user; verify a second low-privilege user cannot connect (or document the check performed).
- [x] **Step 2: Prototype single-instance** via exclusive pipe creation and via a named mutex; verify double-start yields one live host.
- [x] **Step 3: Prototype the shim path:** client connect → send one event → exit, plus the failure path (pipe unreachable → spawn detached hidden → retry once → spool to `%LOCALAPPDATA%\AgentAttention\spool\*.jsonl`). Prove no console window appears on spawn.
- [x] **Step 4: Measure and record** cold and warm shim overhead, receipt-to-dispatch latency, host cold start, and spool-to-ingest order preservation (RF-S2). Compare against PRD §19.3 targets.
- [x] **Step 5: Prototype idle exit** (no live sessions for 10 minutes → graceful shutdown) and crash recovery (kill -9 mid-write → restart sees consistent DB).
- [x] **Step 6: Decide D-03 and amend §9.2** in `PRD.md` if the prototype contradicts it; if in-process embedding was trialled, record why it was accepted/rejected.
- [x] **Step 7: Commit** `docs: s2 process model results and D-03`.

---

### Task 0.7: S2 — SQLite binding evaluation

**Files:**
- Create: `spikes/s2-process-model/sqlite/` (binding A/B prototype)
- Modify: `docs/spikes/s2-results.md`, `PRD.md` (§10 persistence row, §23.1 D-04)

**Interfaces:**
- Produces: **D-04 = chosen SQLite binding**, with the exact package, version, and any postinstall/native-build requirement for Phase 2 Task 2.1.

**Time box: 0.5 day.**

- [x] **Step 1: Prototype the candidates** on Node 24: `node:sqlite` (built-in) and `better-sqlite3` (native). Both must support WAL mode, transactions, and a unique-constraint violation surfaced as an error.
- [x] **Step 2: Test the qualifying criteria:** `npm ci` on a clean profile (no build tools), unpackaged per-user install, no admin, Windows-native, and behavior when the DB is locked by a second process (must fail cleanly, never corrupt).
- [x] **Step 3: Record D-04 in `PRD.md`** with the rejected option and reason.
- [x] **Step 4: Commit** `docs: s2 sqlite binding decision (D-04)`.

---

### Task 0.8: S3 — audio playback prototype

**Files:**
- Create: `spikes/s3-windows-delivery/audio/`
- Modify: `docs/spikes/s3-results.md`

**Time box: 0.5 day.**

- [x] **Step 1: Prototype at least two routes:** PowerShell `System.Media.SoundPlayer` with a fixed script and a file path passed as a parameter, and a Node-native route (e.g., a vetted audio package) if one is viable unpackaged.
- [x] **Step 2: Measure** first-play latency and steady-state latency (cold/warm), behavior with no audio device, behavior when the file is missing, and whether AV/EDR flags the invocation.
- [x] **Step 3: Re-run with the invoking terminal closed** (RF-S3).
- [x] **Step 4: Record results** with the exact command lines; note any way event-derived text could reach the command line (must be none).
- [x] **Step 5: Commit** `docs: s3 audio prototype results`.

---

### Task 0.9: S3 — TTS prototype

**Files:**
- Create: `spikes/s3-windows-delivery/tts/`
- Modify: `docs/spikes/s3-results.md`

**Time box: 0.5 day.**

- [x] **Step 1: Prototype** Windows SAPI / `System.Speech.Synthesis.SpeechSynthesizer` from a fixed PowerShell script, with the text delivered via **stdin** (never interpolated; PRD §17.2).
- [x] **Step 2: Test** voice enumeration, rate/volume control, speech of a hostile string (`"; rm -rf ~ #` plus RTL override chars) proving no command execution and no garbled output path, and behavior when no voice is installed.
- [x] **Step 3: Measure** time-to-first-audio and cancellation behavior (can a queued utterance be stopped?).
- [x] **Step 4: Record results and commit** `docs: s3 tts prototype results`.

---

### Task 0.10: S3 — toast prototype and unpackaged registration

**Files:**
- Create: `spikes/s3-windows-delivery/toast/`
- Modify: `docs/spikes/s3-results.md`, `docs/architecture.md` (registration section if accepted)

**Time box: 1 day.**

- [x] **Step 1: Register a toast identity per-user without admin:** AppUserModelID under `HKCU\Software\Classes\AppUserModelId\...` plus any shortcut requirement; document every registry key or file created (removal is required by `uninstall`).
- [x] **Step 2: Send toasts** with a templated body containing a hostile project name; verify the markup is escaped and renders as text (RF1-class risk).
- [x] **Step 3: Test suppression conditions:** Focus Assist / Do Not Disturb on, notifications disabled for the app, and "quiet hours" Windows setting; record what is detectable and what a toast API reports (must distinguish *submitted* from *seen*, PRD F6-R10).
- [x] **Step 4: Re-run with the invoking terminal closed** (RF-S3); test on a second Windows build if available.
- [x] **Step 5: Record results and commit** `docs: s3 toast prototype results`.

---

### Task 0.11: S3 — focus/foreground detection and click-to-focus feasibility

**Files:**
- Create: `spikes/s3-windows-delivery/focus/`
- Modify: `docs/spikes/s3-results.md`, `PRD.md` (§23.2 Q-06, Q-07; F13 status note)

**Interfaces:**
- Produces: the F13 go/no-go and the provider interface Phase 2 Task 2.13 implements (or the documented unsupported decision).

**Time box: 0.5 day.**

- [x] **Step 1: Detect the foreground window** (e.g., `GetForegroundWindow` via a minimal PowerShell/C# helper or native addon) and map it to the owning process/terminal hosting a session; test with Windows Terminal, VS Code, and one classic console host, including split panes/tabs if relevant.
- [x] **Step 2: Answer Q-06:** is detection reliable enough for F13 (PRD F13-R2)? Record false positives/negatives observed.
- [x] **Step 3: Answer Q-07:** can a toast activation bring the terminal/editor forward without sending input? Prototype activation → focus attempt; verify no keystrokes are delivered.
- [x] **Step 4: Record results; mark Q-06/Q-07 answered in `PRD.md` §23.2** and set F13 to supported or documented-unsupported. Commit `docs: s3 focus detection and click-to-focus results`.

---

### Task 0.12: S3 — choose providers (Q-05) and close the §10 open row

**Files:**
- Modify: `docs/spikes/s3-results.md` (selection matrix), `PRD.md` (§10 audio/TTS/toast row, §23.2 Q-05, §24)
- Produce: one-page selection decision citing Task 0.8–0.11 evidence against the §10 criteria (works unpackaged, no string interpolation, low startup latency, not AV-flagged, no cloud).

**Time box: 0.5 day.**

- [x] **Step 1: Tabulate the routes** (attempted, latency, AV observation, failure modes) and pick sound, TTS, and toast mechanisms.
- [x] **Step 2: Record Q-05 as answered with the decision and rationale; update §10 status from Open to Decided.**
- [x] **Step 3: Commit** `docs: decide windows provider mechanisms (Q-05)`.

---

### Task 0.13: Phase 0 exit review and re-baseline

**Files:**
- Modify: `PRD.md` (§23 decision statuses, §24 change log, §20 estimates if re-baselined)
- Modify: `docs/plans/00-master-plan.md` (mark Phase 0 complete, adjust gates if outcomes changed)
- Modify: `docs/architecture.md` (ratified process model, paths, pipe name)

- [x] **Step 1: Verify every exit criterion** (PRD M0): decision register updated; each spike has a written result; at least one host has a validated approval route plus documented positions on input/turn-end/completion/failure; schedule re-baselined.
- [x] **Step 2: Sweep remaining `[Assumption]` tags** that block Phases 1–2; each is either now `[Verified]` or explicitly deferred with a rationale in §23.2.
- [x] **Step 3: Re-baseline milestone estimates** in PRD §20 based on measured spike outcomes; update the master plan's phase map if a gate moved.
- [x] **Step 4: Review Focus check** (RF-S1..S5): confirm each risk has a recorded result and adjust Phase 2/3 plans accordingly (e.g., if F13 is unsupported, tasks 2.13 and 4.9 are cut with a PRD note).
- [x] **Step 5: Commit** `docs: close phase 0 feasibility spikes`.
