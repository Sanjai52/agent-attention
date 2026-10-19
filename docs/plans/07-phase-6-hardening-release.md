# Phase 6 — Hardening and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satisfy the PRD §21.1 Definition of Done on clean Windows profiles: security review, injection matrix, admin-free install/uninstall verification, packaging with a compatibility matrix, storm/performance evidence, the full A–Q acceptance sweep, completed documentation, and closed open questions.

**Architecture:** No new product surface. This phase hardens, measures, packages, and documents what Phases 0–5 built, applying dogfood findings (Q-11/Q-12 and unhelpful-alert entries from `docs/dogfood-journal.md`).

**Tech Stack:** unchanged; adds packaging (npm pack / host-native plugin archives per host) and CI release workflow.

**Spec:** `PRD.md` §17, §18, §19, §20 (M6), §21, §23.2.

## Global Constraints

- Security review covers every trust boundary in PRD §17.1–17.5 with a written result per item.
- No admin rights anywhere in install/uninstall/update; verified on a clean profile.
- Metrics reported per adapter and per event class against both fixtures and live smoke (PRD §19.3); unsupported events excluded from recall denominators.
- Open questions Q-01…Q-13 each closed (answered with a decision ID) or explicitly deferred with rationale before DoD evaluation (PRD §23.2).
- Release candidate built from a tagged commit; `npm ci` reproducible; lockfile committed.

## Review Focus

- **RF4 — Delivery surface on a clean machine** (no dev tools, no previous install, Focus Assist on). Owning task: 6.2.
- **RF5 — Uninstall leaves zero residue.** Owning task: 6.2.
- **RF1 — Injection matrix completeness.** Owning task: 6.1 (hostile inputs from PRD §17.2 fixtures exercised across toast XML, TTS stdin, sound args, log output).
- **RF2/RF10 — Storm under persistence pressure.** Owning task: 6.4 (50 events/s burst with a real DB and providers stubbed, plus a mid-storm kill).
- **RF11 — Documentation truthfulness.** Owning task: 6.6 (every claim in `installation.md`/`troubleshooting.md` verified against the shipped build, not the plan).

---

### Task 6.1: Security review and injection matrix

**Files:**
- Create: `docs/security-review.md`, `tests/unit/security/injection-matrix.test.ts`
- Modify: `PRD.md` §23.1 (D-15 status if the review changes it), `docs/architecture.md`

**Interfaces:**
- Produces: a matrix of (input vector × sink) cases: hostile project/agent names (quotes, `;`, backticks, `$()`, `%VAR%`, XML chars, 10k chars, Unicode controls, RTL overrides), each exercised against: toast XML generation, TTS stdin, sound file argument, history JSON, human CLI output, and log lines. Every cell asserts no command execution, no markup injection, correct inert rendering (PRD §17.2).

- [ ] **Step 1: Write the matrix test** (RF1) and run it; fix every failure in the owning package (not the test).
- [ ] **Step 2: Walk PRD §17.1–17.5** item by item; record `ok | gap | accepted-risk` with evidence links for each (pipe ACL, spoofing D-15, cross-user denial, adapter identity binding, no payloads, least privilege, failure isolation, log hygiene).
- [ ] **Step 3: Attempt the spoof scenario** (another same-user process sends a crafted event): document the outcome and confirm it can only cause an alert, never an action (D-15).
- [ ] **Step 4: Record results in `docs/security-review.md`; update PRD if anything changed.**
- [ ] **Step 5: Commit** `docs: security review and injection matrix`.

---

### Task 6.2: Clean-profile install/uninstall verification

**Files:**
- Create: `docs/installation-verification.md`
- Test: `tests/integration/install/clean-profile.test.ts` (drives the CLI against temp HOME/APPDATA/LOCALAPPDATA)

**Interfaces:**
- Produces: scripted verification that on a profile with no prior Agent Attention state: `install <host1>` then `install <host2>` succeed without admin; `doctor` is green; both integrations alert; `uninstall <host1>` leaves `<host2>` working; `uninstall <host2>` leaves no registry keys, config dir, data dir, or host config residue except the user's own history/config unless `--purge` (PRD §7.1).
- Environment hygiene: tests set `APPDATA`, `LOCALAPPDATA`, `USERPROFILE` to a temp dir so nothing touches the real machine.

- [ ] **Step 1: Write the integration test** driving real CLI entry points with temp env; assert file tree and registry key presence/absence after each step (RF5).
- [ ] **Step 2: Run it on the development machine and, manually, on a clean Windows profile/VM without admin (record screenshots or command transcripts in `docs/installation-verification.md`).**
- [ ] **Step 3: Verify idempotence on the real machine:** run `install` twice, `uninstall` twice — second runs are no-ops with exit 0.
- [ ] **Step 4: Commit** `docs: clean-profile install and uninstall verification`.

---

### Task 6.3: Packaging, versioning, and compatibility matrix

**Files:**
- Create: `.github/workflows/release.yml`, `docs/compatibility.md`
- Modify: package manifests (bin, files, publishConfig), `docs/installation.md`

**Interfaces:**
- Produces:
  - Reproducible release build: `npm ci && npm run ci && npm pack` per publishable package; host-native plugin packaging for each adapter per its host format (from S1 Q-10 answer).
  - `docs/compatibility.md`: host version × adapter version × Windows version × Node version matrix, generated/updated each release (PRD §18.2).
  - Version checks: host rejects adapters outside `hostVersionRange` with a clear diagnostic (PRD §18.2).

- [ ] **Step 1: Add the release workflow** building artifacts from a tag and attaching the compatibility matrix.
- [ ] **Step 2: Pack both adapters and the CLI; install from the packed artifacts into the temp-profile harness from 6.2 and run the smoke path (proves shipped bundles are self-contained, D-18).**
- [ ] **Step 3: Write `docs/compatibility.md` for the initial release.**
- [ ] **Step 4: Commit** `chore: add release packaging and compatibility matrix`.

---

### Task 6.4: Performance, storm, and resilience evidence

**Files:**
- Create: `tests/integration/performance/storm.test.ts`, `docs/performance-report.md`

**Interfaces:**
- Consumes: Task 2.14 latency smoke; PRD §19.3 targets.
- Produces measured numbers for: receipt-to-dispatch p95 (< 500 ms), shim overhead p95 (< 300 ms, cap 1000 ms), hook-to-audible p95 (< 2 s, stubbed audio acceptable with measured provider overhead added), storm behavior (50 events/s; at most `maxAlertsPerMinute` audible, one summary, complete history), and crash-under-load (kill host mid-storm → restart reconciles, spool preserved, no duplicates).

- [ ] **Step 1: Write the storm test** (RF2/RF10) against the real pipe + real SQLite + stub providers; assert all §19.3 targets and record actual numbers.
- [ ] **Step 2: Add the mid-storm kill test** (RF3/RF10): kill -9, restart, ingest spool, replay ids — assert exactly-once alerting for affected events.
- [ ] **Step 3: Write `docs/performance-report.md`** with methodology, hardware, numbers, and any approved exceptions (PRD DoD: "metrics meet targets or documented, approved exceptions").
- [ ] **Step 4: Produce the per-adapter, per-event-class metric table** (PRD §19.3): recall for authoritative `needs_approval` (≥ 95%), `needs_input` (≥ 95%), verified `completed`/`failed` (≥ 99%); precision ≤ 2% on the adversarial fixture set (≤ 5% for inferred `needs_input`); spurious `turn_ended` = 0 in deterministic fixtures; duplicate audible alerts = 0; session attribution 100% on fixtures; quiet-hour suppression 100%. Unsupported events are excluded from recall denominators. Append the table to `docs/performance-report.md`.
- [ ] **Step 5: Commit** `docs: performance and storm evidence`.

---

### Task 6.5: Full acceptance sweep (A–Q) and DoD checklist

**Files:**
- Create: `tests/acceptance/scenarios.test.ts` (automated where possible), `docs/acceptance-report.md`
- Modify: `PRD.md` §24 (only if semantics changed), `docs/plans/00-master-plan.md`

**Interfaces:**
- Produces: one test (or recorded manual transcript) per PRD §19.2 scenario A–Q: blocking question, progress, approval, completion, concurrent agents, quiet hours, duplicates, notification failure, uncertain state, idle-only, classified-beats-idle, failure, denial, storm, hostile name, restart, unsupported environment.

- [ ] **Step 1: Automate A–Q where the harness allows** (pipelines with stub providers, fake clocks); record the rest as manual transcripts with dates and versions.
- [ ] **Step 2: Run the PRD §21.1 Definition of Done** as a checklist; every item gets a link to its evidence. Any unmet item becomes a blocking issue before release.
- [ ] **Step 3: Close or defer each Q-01…Q-13** in PRD §23.2 with a decision reference or explicit rationale (PRD requirement before DoD evaluation).
- [ ] **Step 4: Apply dogfood findings:** Q-11 (`minTurnSeconds`/`graceMs` defaults) and Q-12 (reminders default) decided from `docs/dogfood-journal.md`; unhelpful-alert entries from the journal resolved or documented.
- [ ] **Step 5: Write `docs/acceptance-report.md` and commit** `docs: acceptance sweep and definition of done`.

---

### Task 6.6: Documentation completion

**Files:**
- Modify: `docs/architecture.md`, `docs/event-contract.md`, `docs/adapter-development.md`, `docs/installation.md`, `docs/troubleshooting.md`, `README.md`, `docs/host-signal-matrix.md`
- Create: `docs/verification.md` (redirect map: which doc answers which PRD section)

**Interfaces:**
- Produces: documentation that a new contributor can follow to add a third adapter (using Phase 3/5 as the worked example) and a new user can follow to install, configure, and diagnose — every command and file path verified against the shipped build (RF11).

- [ ] **Step 1: Dry-run the docs:** follow `installation.md` on a clean temp profile and `adapter-development.md` mentally against the two existing adapters; fix every drift.
- [ ] **Step 2: Verify every default value, path, and command in the docs against the code (script a check where feasible: grep the docs for config keys and compare to `defaultConfig`).**
- [ ] **Step 3: Update the root `README.md`** with install/quickstart/links.
- [ ] **Step 4: Commit** `docs: complete user and contributor documentation`.

---

### Task 6.7: Release candidate and PRD close-out

**Files:**
- Modify: `PRD.md` (status field: `Released — MVP`; §23 statuses; §24 change log), `docs/plans/00-master-plan.md` (all boxes), `CHANGELOG.md` (create)

- [ ] **Step 1: Cut the release candidate** from a tagged commit; run the full `npm run ci` plus 6.5's acceptance report against the tag.
- [ ] **Step 2: Verify no standalone desktop application is required** (DoD final line): a fresh user installs two integrations, receives alerts, queries history — no separate app ever opened.
- [ ] **Step 3: Update `PRD.md` status and change log; mark the master plan complete; write `CHANGELOG.md` for 1.0.0.**
- [ ] **Step 4: Commit and tag** `chore: release 1.0.0` with tag `v1.0.0`.

---

## Post-MVP Backlog (non-binding, from PRD §22)

Not part of this plan; recorded here only so nothing is lost: WSL/remote via a Windows-side host, remote/mobile push, macOS/Linux providers, away heuristics, click-to-focus, per-agent/per-project policies, host-native panels, competing-approaches review (scheduled before Milestone 3 in PRD §22 — verify it was completed during Phase 3/5 and record it in `docs/`).
