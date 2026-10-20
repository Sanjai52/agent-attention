# S2 SQLite binding probe — private shard (Task 0.7)

Status: complete for the criteria in Task 0.7.
Scope: D-04 only — which SQLite binding ships in the Notification Host on
Windows, unpackaged, per-user. Process-model measurements (Task 0.6) are out of
scope and are not recorded here.

Merge note: record IDs below are provisional (`S2-SQL-*`) so they cannot collide
with `S2-01…` written by Task 0.6. Renumber on merge into
`docs/spikes/s2-results.md`.

Spike code: [`../../spikes/s2-process-model/sqlite/`](../../spikes/s2-process-model/sqlite/)
(gitignored artifacts under `spikes/s2-process-model/sqlite/out/`).

## Environment (measured 2026-10-20)

| Item | Value |
|---|---|
| OS | `Microsoft Windows NT 10.0.26300.0`; registry `ProductName=Windows 10 Home Single Language`, `DisplayVersion=26H2`, build `26300.9711` |
| Architecture | `x64` |
| Node.js | `v24.20.0` (V8 `13.6.233.17-node.53`, npm `11.19.0`) |
| Bundled SQLite (`node:sqlite`) | `3.53.4` |
| Install prefix | `C:\Users\sanja\AppData\Roaming\npm` (per-user) |
| Running as admin | `IsAdmin=False` (PowerShell `WindowsPrincipal.IsInRole(Administrator)`) |
| C++ build tools | **Absent.** VS Build Tools 2022 `17.14.36511.14` is installed but without the C++ workload: `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` returns nothing, no `cl.exe`, no `C:\Program Files (x86)\Windows Kits\10\bin`. |
| Python | `3.11.9` at `C:\Users\sanja\AppData\Local\Programs\Python\Python311\python.exe` (present but unusable without MSVC) |

The absent C++ toolchain makes the Task 0.7 "clean install without build tools"
criterion a genuine test rather than a simulated one.

## Records

### S2-SQL-01 — Does `node:sqlite` support WAL, transactions, and a unique-constraint error?

- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Node 24.20.0, bundled SQLite 3.53.4.
- Method (exact command or script path): `cd spikes/s2-process-model/sqlite && node src/probe.mjs node out/probe-node.db`
- Raw observation (verbatim output excerpt; full log `out/probe-node.log`):

```json
{"step":"open","binding":"node:sqlite","module":"node:sqlite","node":"v24.20.0","sqlite":"3.53.4","dbPath":"...\\out\\probe-node.db"}
{"step":"journal_mode","value":{"journal_mode":"wal"}}
{"step":"busy_timeout","value":{"timeout":0}}
{"step":"transaction_commit","value":{"n":1}}
{"step":"transaction_rollback","value":{"n":1}}
{"step":"unique_violation","threw":true,"error":{"name":"Error","message":"UNIQUE constraint failed: t.name","code":"ERR_SQLITE_ERROR","errcode":2067,"errstr":"constraint failed"}}
{"step":"integrity_check","value":{"integrity_check":"ok"}}
{"step":"journal_mode_after","value":{"journal_mode":"wal"}}
{"step":"summary","binding":"node","ok":true,"steps":8}
```

  Importing `node:sqlite` on 24.20.0 produced **no** `ExperimentalWarning`
  (`out/node-sqlite-stderr.log` is empty).
- Conclusion: all three required behaviors work. WAL persists (`journal_mode=wal`
  after close), `BEGIN`/`COMMIT`/`ROLLBACK` behaves correctly, and the UNIQUE
  violation is a thrown `Error` with `code=ERR_SQLITE_ERROR` and the SQLite
  extended result code in `errcode=2067` (`SQLITE_CONSTRAINT_UNIQUE`). Callers
  must key on `errcode`, not on the string `code`, to distinguish constraint
  from busy failures.
- Tag: [Verified]

### S2-SQL-02 — Does `better-sqlite3` support the same three behaviors?

- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / `better-sqlite3@12.4.1`, bundled SQLite 3.50.4, Node 24.20.0.
- Method (exact command or script path): `node src/probe.mjs better out/probe-better.db` after `npm install` in the spike dir.
- Raw observation (verbatim output excerpt; full log `out/probe-better.log`):

```json
{"step":"open","binding":"better-sqlite3","version":"12.4.1","sqlite":"3.50.4","dbPath":"...\\out\\probe-better.db"}
{"step":"journal_mode","value":"wal"}
{"step":"transaction_commit","value":{"n":1}}
{"step":"transaction_rollback","value":{"n":1}}
{"step":"unique_violation","threw":true,"error":{"name":"SqliteError","message":"UNIQUE constraint failed: t.name","code":"SQLITE_CONSTRAINT_UNIQUE","errcode":null,"errstr":null}}
{"step":"integrity_check","value":"ok"}
{"step":"summary","binding":"better","ok":true,"steps":8}
```

- Conclusion: all three behaviors work with the same semantics. The unique
  violation is a `SqliteError` with `code=SQLITE_CONSTRAINT_UNIQUE`.
- Tag: [Verified]

### S2-SQL-03 — Can each option install on this host without C++ build tools, per-user, without admin?

- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Node 24.20.0, npm 11.19.0; no MSVC C++ workload, no Windows SDK.
- Method (exact command or script path):
  1. `cd spikes/s2-process-model/sqlite && npm install --no-audit --no-fund --foreground-scripts --loglevel info` (`out/npm-install-better-sqlite3.log`)
  2. `rm -rf node_modules && npm ci --no-audit --no-fund --foreground-scripts --loglevel info` (`out/npm-ci.log`)
  3. From-source control in `out/build-from-source/`: `npm install --build-from-source` (`out/npm-install-build-from-source.log`)
- Raw observation (verbatim excerpts):

```text
npm info run better-sqlite3@12.4.1 install node_modules/better-sqlite3 prebuild-install || node-gyp rebuild --release
prebuild-install info looking for cached prebuild @ C:\Users\sanja\AppData\Local\npm-cache\_prebuilds\df8a55-better-sqlite3-v12.4.1-node-v137-win32-x64.tar.gz
prebuild-install http request GET https://github.com/WiseLibs/better-sqlite3/releases/download/v12.4.1/better-sqlite3-v12.4.1-node-v137-win32-x64.tar.gz
prebuild-install http 200
prebuild-install info install Successfully installed prebuilt binary!
added 38 packages in 8s
npm warn deprecated prebuild-install@7.1.3: No longer maintained. Please contact the author of the relevant native addon; alternatives are available.
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn install-scripts   better-sqlite3@12.4.1 (install: prebuild-install || node-gyp rebuild --release)
```

  Second run with a warm npm cache: `npm ci` exited `0` in `6549 ms`, prefixed by
  `prebuild-install info found cached prebuild`. Installed binary:
  `node_modules/better-sqlite3/build/Release/better_sqlite3.node`, 1 897 472 bytes.

  From-source control (same host, no C++ workload):

```text
gyp ERR! find VS You need to install the latest version of Visual Studio
gyp ERR! find VS including the "Desktop development with C++" workload.
gyp ERR! stack Error: Could not find any Visual Studio installation to use
npm error command failed
npm error command C:\WINDOWS\system32\cmd.exe /d /s /c prebuild-install || node-gyp rebuild --release
```

  `npm install --build-from-source` exited `1`.

  `node:sqlite` needs no install step at all: `node -e "import('node:sqlite')"`
  succeeds on a stock Node 24.20.0 install (`builtinModules` does not list it
  because it is only exposed under the `node:` scheme).
- Conclusion: `better-sqlite3@12.4.1` installs **only** through its prebuilt
  binary on this host; the compiler fallback is genuinely unavailable. The
  prebuilt path downloaded without admin into a per-user directory and worked.
  `node:sqlite` requires no package, no postinstall, no network beyond Node
  itself.
- Tag: [Verified] for the install outcomes; [Assumption] for the claim that
  `better-sqlite3` installs on *other* hosts without build tools — the prebuilt
  exists for `win32-x64`/ABI `node-v137`, but only this host was measured.

### S2-SQL-04 — Is install unpackaged and per-user with no admin?

- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Node 24.20.0, npm prefix `C:\Users\sanja\AppData\Roaming\npm`.
- Method (exact command or script path): `npm config get prefix`; `npm install` in a plain directory with only `package.json`; PowerShell admin check; `git check-ignore` for generated artifacts.
- Raw observation (verbatim):

```text
User=LAPTOP-48SUV1B9\sanjai
IsAdmin=False
C:\Users\sanja\AppData\Roaming\npm
C:\Users\sanja\AppData\Local\npm-cache
```

  The spike directory has a standalone `package.json` + committed
  `package-lock.json`; no global install, no service, no registry write, no
  elevation prompt. `spikes/**/out/` and `node_modules/` are gitignored.
- Conclusion: both options satisfy unpackaged, per-user, no-admin. The
  difference is that `node:sqlite` has nothing to install at all.
- Tag: [Verified]

### S2-SQL-05 — What happens when a second process holds the DB lock?

- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Node 24.20.0; `better-sqlite3@12.4.1`.
- Method (exact command or script path):
  `node src/run-lock-test.mjs <node|better> <zero|default|timeout>`.
  `src/hold-lock.mjs` opens the DB, sets `busy_timeout=0`, runs `BEGIN IMMEDIATE`
  and inserts one row, holds for 2500 ms, commits. `src/lock-probe.mjs` runs in a
  separate process while the lock is held; `zero` sets `busy_timeout=0`,
  `default` leaves the binding default, `timeout` passes
  `new DatabaseSync(path, { timeout: 5000 })` (node only).
- Raw observation (verbatim excerpts; full logs `out/lock-*.log`):

```text
=== node zero ===
{"step":"open_while_locked","mode":"zero","ok":true,"ms":2.6,"busy_timeout":0}
{"step":"write_while_locked","mode":"zero","threw":true,"ms":17.54,"error":{"name":"Error","message":"database is locked","code":"ERR_SQLITE_ERROR","errcode":5,"errstr":"database is locked"}}
{"step":"read_while_locked","mode":"zero","ok":true,"rows":1}
{"step":"integrity_check","mode":"zero","ok":true,"value":{"integrity_check":"ok"}}

=== node default ===
{"step":"open_while_locked","mode":"default","ok":true,"ms":1.83,"busy_timeout":0}
{"step":"write_while_locked","mode":"default","threw":true,"ms":14,"error":{"name":"Error","message":"database is locked","code":"ERR_SQLITE_ERROR","errcode":5,"errstr":"database is locked"}}

=== node timeout ===
{"step":"open_while_locked","mode":"timeout","ok":true,"ms":1.99,"busy_timeout":5000}
{"step":"write_while_locked","mode":"timeout","threw":false}
{"step":"read_while_locked","mode":"timeout","ok":true,"rows":3}
{"step":"integrity_check","mode":"timeout","ok":true,"value":{"integrity_check":"ok"}}

=== better zero ===
{"step":"open_while_locked","mode":"zero","ok":true,"ms":9.64,"busy_timeout":0}
{"step":"write_while_locked","mode":"zero","threw":true,"ms":18.39,"error":{"name":"SqliteError","message":"database is locked","code":"SQLITE_BUSY","errcode":null,"errstr":null}}
{"step":"read_while_locked","mode":"zero","ok":true,"rows":1}
{"step":"integrity_check","mode":"zero","ok":true,"value":{"integrity_check":"ok"}}

=== better default ===
{"step":"open_while_locked","mode":"default","ok":true,"ms":9.65,"busy_timeout":5000}
{"step":"write_while_locked","mode":"default","threw":false}
{"step":"read_while_locked","mode":"default","ok":true,"rows":3}
```

- Conclusion: neither binding corrupts the database under a held write lock.
  Both surface the lock as a thrown error when the busy timeout is 0, and both
  read committed rows under WAL while the writer holds the lock. Important
  difference: **`node:sqlite` defaults to `busy_timeout = 0`** (immediate
  `SQLITE_BUSY`, measured `errcode 5`), while `better-sqlite3` defaults to
  `5000 ms` and silently waited out the 2.5 s holder. The host must configure
  the timeout explicitly; relying on defaults gives opposite behavior.
- Tag: [Verified]

### S2-SQL-06 — Does multi-process contention corrupt the file or lose acknowledged rows?

- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Node 24.20.0; `better-sqlite3@12.4.1`.
- Method (exact command or script path): `node src/run-stress.mjs <node|better> 3 50` (3 concurrent writer processes × 50 inserts, WAL, 5000 ms busy timeout, retry up to 5 on busy; then `PRAGMA integrity_check` and row count).
- Raw observation (verbatim excerpts; `out/stress-node.log`, `out/stress-better.log`):

```text
{"step":"writer_done","binding":"node","workerId":"0","inserted":50,"busyRetries":0,"errors":[],"ms":146.9}
{"step":"writer_done","binding":"node","workerId":"1","inserted":50,"busyRetries":0,"errors":[],"ms":276.2}
{"step":"writer_done","binding":"node","workerId":"2","inserted":50,"busyRetries":0,"errors":[],"ms":431.9}
{"step":"stress_elapsed","binding":"node","workers":3,"countEach":50,"ms":572.7}
{"step":"verify","count":151,"integrity":"ok","journal":"wal"}

{"step":"writer_done","binding":"better","workerId":"0","inserted":50,"busyRetries":0,"errors":[],"ms":11.4}
{"step":"writer_done","binding":"better","workerId":"1","inserted":50,"busyRetries":0,"errors":[],"ms":13.7}
{"step":"writer_done","binding":"better","workerId":"2","inserted":50,"busyRetries":0,"errors":[],"ms":34.1}
{"step":"stress_elapsed","binding":"better","workers":3,"countEach":50,"ms":166.2}
{"step":"verify","count":151,"integrity":"ok","journal":"wal"}
```

- Conclusion: 151/151 rows present (1 seed + 150) and `integrity_check=ok` for
  both. Local wall time was ~3.4× higher for `node:sqlite` on this micro-run
  (573 ms vs 166 ms for 3×50 single-row inserts), which is irrelevant to the
  product's single-writer load but is recorded as measured. This is a warm,
  local, small-sample result — not a throughput benchmark.
- Tag: [Verified] for integrity/row count; latency numbers are single-run
  observations, not p50/p95.

### S2-SQL-07 — What breaks if postinstall scripts do not run?

- Date / Windows build / tool versions: 2026-10-20 / 10.0.26300.9711 / Node 24.20.0, npm 11.19.0.
- Method (exact command or script path): `npm ci --ignore-scripts --no-audit --no-fund` in the spike dir (`out/npm-ci-ignore-scripts.log`), then `node src/probe.mjs better out/probe-better-ignorescripts.db`.
- Raw observation (verbatim excerpt; `out/probe-better-ignorescripts.log`):

```text
Error: Could not locate the bindings file. Tried:
 → ...\node_modules\better-sqlite3\build\better_sqlite3.node
 → ...\node_modules\better-sqlite3\build\Debug\better_sqlite3.node
 → ...\node_modules\better-sqlite3\build\Release\better_sqlite3.node
    at bindings (...\node_modules\bindings\bindings.js:126:9)
    at new Database (...\node_modules\better-sqlite3\lib\database.js:48:64)
```

  `npm ci` itself exited `0`; only the runtime require failed. npm 11 also emits
  `npm warn install-scripts ... not yet covered by allowScripts`, so a stricter
  script-approval policy (or a corporate `ignore-scripts=true`) leaves a silently
  broken install.
- Conclusion: `better-sqlite3` is unusable whenever install scripts are
  suppressed, even though installation "succeeds". `node:sqlite` has no such
  state.
- Tag: [Verified]

## Comparison against the Task 0.7 criteria

| Criterion | `node:sqlite` (Node 24.20.0) | `better-sqlite3@12.4.1` |
|---|---|---|
| WAL mode | Yes — `wal`, persists across close [Verified] | Yes — `wal` [Verified] |
| Transactions | Yes — `BEGIN`/`COMMIT`/`ROLLBACK` [Verified] | Yes [Verified] |
| Unique violation as error | Yes — `ERR_SQLITE_ERROR`, `errcode=2067` [Verified] | Yes — `SqliteError`, `SQLITE_CONSTRAINT_UNIQUE` [Verified] |
| Install with no C++ build tools | No install at all [Verified] | Prebuilt binary only; from-source fails on this host [Verified] |
| Unpackaged, per-user, no admin | Yes (built into Node) [Verified] | Yes, into user dir [Verified] |
| Windows-native | Yes, bundled SQLite 3.53.4 [Verified] | Yes, prebuilt `win32-x64` [Verified] |
| Second-process lock | Clean `SQLITE_BUSY` at 14–18 ms with timeout 0; reads OK; `integrity_check=ok`; configurable `timeout` [Verified] | Clean `SQLITE_BUSY` with timeout 0; default 5000 ms waits; `integrity_check=ok` [Verified] |
| Extra install risk | None beyond Node itself | GitHub release download, install script, `prebuild-install` (deprecated), 38 packages, ABI `node-v137` [Verified] |
| API stability | `node:sqlite` Stability **1.2 — Release candidate** in Node 24 docs [Assumption → cited] | Mature 3rd-party API [Assumption] |

## D-04 recommendation

**Choose the built-in `node:sqlite` (`DatabaseSync`) on Node.js 24 LTS, tested
on Node 24.20.0 (bundled SQLite 3.53.4).**

- Package: none — `node:sqlite` is part of the runtime.
- Exact version: Node.js **24.20.0** (minimum for this evidence; pin the runtime,
  not a SQLite package). `engines.node` should be `>=24.20.0 <25` until a later
  LTS is re-tested.
- Postinstall / native build: **none**. No `node-gyp`, no MSVC, no prebuilt
  download, no install script. This is the decisive criterion for an unpackaged
  per-user Windows tool.
- Rejected option: **`better-sqlite3@12.4.1`**. It passed every functional check
  and did install on this compiler-less host via the `win32-x64`/ABI 137 prebuilt,
  but its install depends on a GitHub release download plus a postinstall script:
  `npm ci --ignore-scripts` produced a successful install with a runtime
  "Could not locate the bindings file" failure, `--build-from-source` failed with
  `Could not find any Visual Studio installation`, and the tree pulls 38 packages
  plus the deprecated `prebuild-install`. Rejected on install robustness and
  supply-chain surface, not on capability.

Required implementation constraints for Phase 2 Task 2.1:

1. Construct with an explicit busy timeout, e.g.
   `new DatabaseSync(dbPath, { timeout: 5000 })`; the default is `0` and will
   throw `SQLITE_BUSY` immediately under any overlapping writer.
2. Treat `errcode === 5` (`SQLITE_BUSY`) as retryable and
   `errcode === 2067` (`SQLITE_CONSTRAINT_UNIQUE`) as a domain conflict; do not
   branch on the generic `code` string (`ERR_SQLITE_ERROR` covers both).
3. Keep `node:sqlite` behind a narrow storage adapter. The module is Stability
   1.2 (release candidate) in Node 24; isolate it so a Node 26 re-test is a
   one-file change.
4. Do not enable `allowExtension`; the default `defensive: true` is appropriate.
5. Single-writer rule stands: adapters never open the DB (PRD §9.2/§15).

Residual risk: Node 24 is LTS, but `node:sqlite` is still labelled release
candidate and its API changed across 22→24. Mitigation is the pinned runtime
range plus storage contract tests; if a future LTS removes or renames an API,
only the adapter changes.

## Proposed PRD §10 text (persistence row)

Replace:

> | Persistence | SQLite, single-writer in Notification Host; binding choice (built-in vs native module) decided in S2 | Proposed |

with:

> | Persistence | SQLite via built-in `node:sqlite` (`DatabaseSync`); single-writer in Notification Host; WAL; explicit transactions; busy timeout configured explicitly (default is 0). No native module, no postinstall build; requires Node ≥24.20.0 | Decided (D-04) |

## Proposed PRD §23.1 D-04 text

Replace:

> | D-04 | Single-writer SQLite owned by Notification Host; adapters never open the DB | Proposed (S2) |

with:

> | D-04 | SQLite binding: built-in `node:sqlite` (`DatabaseSync`) on Node.js 24 LTS (tested 24.20.0, bundled SQLite 3.53.4); Notification Host is the single writer and adapters never open the DB. `better-sqlite3@12.4.1` rejected: functionally equivalent via its prebuilt binary, but adds a postinstall native download that fails under `--ignore-scripts` and cannot compile on a host without the MSVC C++ workload. | Decided (S2) |

## Limits of this evidence

- One host, one Node patch level (24.20.0), one Windows build (26300.9711).
  Other Windows builds and Node 25/26 were not tested. [Assumption]
- Lock tests use a synthetic holder with `BEGIN IMMEDIATE`, not the real
  Notification Host. [Assumption → bounded by design]
- Latency numbers are single runs on a warm filesystem; they are not p50/p95 and
  must not be quoted as performance targets. [Assumption]
- No AV/EDR observation was made for either binding. Out of scope for D-04.
- The `node:sqlite` stability grade comes from the Node 24 documentation
  (`https://nodejs.org/docs/latest-v24.x/api/sqlite.html`, accessed 2026-10-20,
  "Stability: 1.2 - Release candidate"); the local 24.20.0 run emitted no
  experimental warning.

## Artifact index (gitignored)

| File | Contents |
|---|---|
| `out/probe-node.log`, `out/probe-better.log` | Core feature runs |
| `out/lock-{node,better}-{zero,default}.log`, `out/lock-node-timeout.log` | Lock behavior |
| `out/stress-{node,better}.log` | 3×50 concurrent writers |
| `out/npm-install-better-sqlite3.log`, `out/npm-ci.log` | Install/prebuilt evidence |
| `out/npm-install-build-from-source.log` | Compiler absence proof |
| `out/npm-ci-ignore-scripts.log`, `out/probe-better-ignorescripts.log` | Broken-install evidence |
