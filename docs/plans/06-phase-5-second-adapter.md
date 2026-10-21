# Phase 5 — Second Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the second host integration from the S1 scorecard, reusing the shared core with no core changes beyond contract-level fixes (PRD M5 exit), and prove multi-agent history works.

**Architecture:** Same thin-adapter shape as Phase 3: normalize → shim → host. The second adapter MUST NOT reimplement deduplication, preferences, quiet hours, fingerprints, state transitions, or templates (PRD §16.7). Its execution model (in-process plugin vs hook process) follows that host's documented mechanism with the §9.2 non-blocking rules.

**Tech Stack:** As Phase 3; the second host's documented hooks/extensions from Task 0.3/0.4.

**Spec:** `PRD.md` §9.2, §16.2–16.7, §18, §19.1.

## Global Constraints

- Reuse rule: any change needed in `packages/core`/`packages/contract` is a contract-level fix and must be recorded in PRD §24; adapter-specific logic stays in the adapter package (PRD §16.7).
- Capability declaration is the only place support is claimed; `doctor` and tests read from it (PRD §16.2).
- Install/uninstall: merge + backup + idempotent + no admin (PRD §18.4).
- Fixtures-first testing (D-08): recorded-event fixtures gate CI; live smoke is manual.

## Review Focus

- **RF6 — Host upgrade changes payloads.** Owning task: 5.5 (fixture contract tests defined as the downgrade trigger, PRD §18.3).
- **RF2 — This host's duplicates differ from host one's.** Owning task: 5.2 (fixture with repeated hook firing).
- **RF5 — Second installer on a machine that already has the first.** Owning task: 5.3 (both installed, then uninstall one, first still works).
- **RF9 — Core leakage.** Owning task: 5.5 (diff-level assertion that core changed only for contract fixes, with PRD §24 entries).
- **RF1 — Hostile names from the second host.** Owning task: 5.2.

---

### Task 5.1: Adapter skeleton and capability declaration

**Files:**
- Create: `adapters/<host2>/src/{index,adapter,capabilities}.ts`
- Test: `tests/unit/adapters/<host2>/capabilities.test.ts`

**Interfaces:**
- Consumes: Task 3.1 shape (copy the structure, not the code); Task 0.3/0.4 matrix row for `<host2>`.
- Produces: `createAdapter(...)` and `capabilitiesFor(hostVersion)` exactly as Phase 3 Task 3.1.

- [x] **Steps 1–5 complete:** Claude Code capability and lifecycle skeleton is implemented and tested.

---

### Task 5.2: Signal mapping and fixtures

**Files:**
- Create: `adapters/<host2>/src/normalize/*.ts`
- Fixtures: `tests/fixtures/<host2>/*.jsonl` (recorded per Task 0.3/0.4 captures)
- Test: `tests/unit/adapters/<host2>/*.test.ts`

**Interfaces:**
- Consumes: Phase 1 pipeline + Phase 3 test helpers.
- Produces: normalization for every declared event: session lifecycle, approval (+resolution if `supportsResolutionSignals`), blocking input (only if verified; else `unsupported` + `turn_ended` fallback), turn-end, completion (only authoritative), failure/cancel, subagents/task scope when declared.
- Same hard rules as Phase 3: no free text or payloads (AC-F3-07), `inferred` confidence where declared inferred (AC-J), idle never completion (AC-F2-03).

- [x] **Steps 1–5 complete:** sanitized Claude Code fixture replay, hook normalization, duplicate suppression, hostile-name bounds, and capability gating pass.

---

### Task 5.3: Install and uninstall

**Files:**
- Create: `packages/cli/src/install/host-<host2>.ts`
- Test: `tests/unit/cli/install-<host2>.test.ts`

**Interfaces:** identical to Task 3.7.

- [x] **Steps 1–5 complete:** Claude Code settings merge, backup, idempotence, preservation, uninstall, and CLI routing pass.

---

### Task 5.4: Live smoke suite

**Files:**
- Create: `tests/live-smoke/<host2>.smoke.ts`
- Modify: `docs/host-signal-matrix.md` (measured vs declared for `<host2>`)

- [ ] **Step 1: Run the interactive Claude Code capture.** The local runtime is 2.1.304 while the verified S1 evidence is 2.1.181; the manual harness and sanitized fixture are ready.
- [x] **Step 2:** Capability boundaries and version mismatch are recorded in `docs/host-signal-matrix.md`; no unsupported live behavior is claimed.
- [x] **Step 3:** Manual smoke harness and evidence documentation are committed. Fresh interactive capture remains a release-review prerequisite.

---

### Task 5.5: Shared contract tests and core-leak check

**Files:**
- Create: `tests/integration/contract/shared-adapter-tests.ts` (the shared suite), `tests/integration/contract/all-adapters.test.ts`
- Modify: `docs/adapter-development.md`
- Test: `tests/integration/contract/all-adapters.test.ts`

**Interfaces:**
- Produces: `adapterContractSuite(name: string, adapter: AgentAttentionAdapter, fixtures: FixtureStream[])` asserting: capability schema validity; no unsupported-type emission across all fixtures; confidence discipline; contract-valid events only; duplicate idempotence.
- Core-leak check (RF9): a CI step `git diff --stat` review recorded as a PR checklist item — the plan requires a written statement in the PR body when `packages/core` changed: which contract-level fix, which PRD §24 entry.

- [x] **Steps 1–5 complete for the contract boundary:** both adapters pass capability, parse, unsupported-event, and interleaving/no-cross-talk checks without core changes.

---

### Task 5.6: Phase 5 exit verification

- [x] **Step 1:** Local `npm run ci` passes on the integrated branch.
- [x] **Step 2:** The second adapter reuses the core and contract without shared-package changes; supported-event tests pass.
- [x] **Step 3:** Installation, troubleshooting, adapter-development, host-matrix, and Phase 5 progress docs are updated.
- [ ] **Step 4:** Final closure waits for the fresh interactive Claude Code capture, GitHub Actions on the Phase 5 branch, and explicit release-review approval.
