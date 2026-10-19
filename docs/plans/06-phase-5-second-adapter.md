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

- [ ] **Step 1: Write failing tests** (capability schema valid; every authoritative entry cites a `sourceSignal`; unsupported types rejected by `assertEmittable`).
- [ ] **Step 2: Run** `npx vitest run tests/unit/adapters/<host2>/capabilities.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the skeleton and hook/plugin registration for this host's execution model.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapter-<host2>): add skeleton and capability declaration`.

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

- [ ] **Step 1: Write failing fixture tests** mirroring Phase 3 Tasks 3.2–3.6, including a duplicate-hook-fire fixture (RF2) and a hostile-project-name fixture (RF1).
- [ ] **Step 2: Run** `npx vitest run tests/unit/adapters/<host2>`. Expected: FAIL.
- [ ] **Step 3: Implement normalization; declare unsupported anything the matrix did not verify.**
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapter-<host2>): map host signals`.

---

### Task 5.3: Install and uninstall

**Files:**
- Create: `packages/cli/src/install/host-<host2>.ts`
- Test: `tests/unit/cli/install-<host2>.test.ts`

**Interfaces:** identical to Task 3.7.

- [ ] **Step 1: Write failing tests (RF5):** the Phase 3 install and this install coexist in one config directory without interfering; installing `<host2>` does not modify `<host1>` entries; uninstalling `<host2>` leaves `<host1>` fully functional; backup/idempotence rules from 3.7.**
- [ ] **Step 2: Run** `npx vitest run tests/unit/cli/install-<host2>.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add <host2> install and uninstall`.

---

### Task 5.4: Live smoke suite

**Files:**
- Create: `tests/live-smoke/<host2>.smoke.ts`
- Modify: `docs/host-signal-matrix.md` (measured vs declared for `<host2>`)

- [ ] **Step 1: Cover the same scenario list as Task 3.8** against a real `<host2>` session.
- [ ] **Step 2: Record per-event detection and confidence; downgrade declarations for any mismatch (PRD §18.3).**
- [ ] **Step 3: Commit** `docs: <host2> live smoke results`.

---

### Task 5.5: Shared contract tests and core-leak check

**Files:**
- Create: `tests/integration/contract/shared-adapter-tests.ts` (the shared suite), `tests/integration/contract/all-adapters.test.ts`
- Modify: `docs/adapter-development.md`
- Test: `tests/integration/contract/all-adapters.test.ts`

**Interfaces:**
- Produces: `adapterContractSuite(name: string, adapter: AgentAttentionAdapter, fixtures: FixtureStream[])` asserting: capability schema validity; no unsupported-type emission across all fixtures; confidence discipline; contract-valid events only; duplicate idempotence.
- Core-leak check (RF9): a CI step `git diff --stat` review recorded as a PR checklist item — the plan requires a written statement in the PR body when `packages/core` changed: which contract-level fix, which PRD §24 entry.

- [ ] **Step 1: Write the shared suite and run both adapters through it.**
- [ ] **Step 2: Run** `npx vitest run tests/integration/contract/all-adapters.test.ts`. Expected: it fails until any per-adapter gaps are fixed.
- [ ] **Step 3: Fix gaps inside the adapters, not the core. If a core change is unavoidable, record it in PRD §24 and re-run Phase 1 tests.**
- [ ] **Step 4: Multi-agent proof:** integration test with both adapters' fixture streams interleaved → history separates agents, no cross-talk (PRD persona requirement).**
- [ ] **Step 5: Commit** `test: add shared adapter contract suite`.

---

### Task 5.6: Phase 5 exit verification

- [ ] **Step 1: Run** `npm run ci`. Expected: all green.
- [ ] **Step 2: Verify PRD M5 exit:** second adapter reuses the core without core changes beyond contract-level fixes (record the diff statement), and passes its supported-event tests.
- [ ] **Step 3: Update** docs (`installation.md`, `troubleshooting.md`, `adapter-development.md`), master plan checkbox.
- [ ] **Step 4: Commit** `docs: close phase 5 second adapter`.
