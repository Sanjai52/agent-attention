# S2 — SQLite binding A/B (Task 0.7, D-04)

Throwaway probe for the D-04 decision: `node:sqlite` (built-in) vs
`better-sqlite3` (native module) on Node 24 / Windows.

**Do not promote.** Phase 2 implements the store against PRD §12–§15; this code
exists only to produce the measurements in
[`../../../docs/spikes/phase-0-shards/s2-sqlite.md`](../../../docs/spikes/phase-0-shards/s2-sqlite.md).

## What it checks

| Probe | Question |
|---|---|
| `src/probe.mjs` | Does the binding open the DB, enable WAL, commit/rollback a transaction, surface a UNIQUE violation as an error, and report `integrity_check = ok`? |
| `src/run-lock-test.mjs` | With a second process holding a write transaction, does a write fail cleanly (no corruption) or wait, depending on the configured busy timeout? |
| `src/run-stress.mjs` | Under 3 concurrent writers, are all acknowledged rows present and the file intact? |
| install log | Can the package install per-user, without admin, on a host **without** a C++ compiler? What happens when the prebuilt download is skipped? |

## Reproduce

Working directory: `spikes/s2-process-model/sqlite/`.

```powershell
node --version                  # v24.20.0
npm install --no-audit --no-fund --foreground-scripts
node src/probe.mjs node   out/probe-node.db
node src/probe.mjs better out/probe-better.db
node src/run-lock-test.mjs node zero
node src/run-lock-test.mjs node default
node src/run-lock-test.mjs node timeout
node src/run-lock-test.mjs better zero
node src/run-lock-test.mjs better default
node src/run-stress.mjs node 3 50
node src/run-stress.mjs better 3 50
```

Failure-mode checks used in the evidence record:

```powershell
npm ci --ignore-scripts            # then require better-sqlite3 -> bindings error
npm install --build-from-source    # in a scratch dir -> node-gyp: no Visual Studio
```

Generated databases and logs live in `out/` (gitignored). `package-lock.json` is
committed so the tested `better-sqlite3` version is reproducible.
