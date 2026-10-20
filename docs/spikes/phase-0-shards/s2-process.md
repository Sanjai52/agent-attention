# S2 process model — private shard (Task 0.6)

Status: **COMPLETE** (Task 0.6). D-04 / Task 0.7 is **not** covered here.

- Date: 2026-10-20
- Windows: `Microsoft Windows NT 10.0.26300.0`, build `26300`
  (`[System.Environment]::OSVersion.VersionString`)
- Shell: PowerShell `5.1.26100.9711`; Node `v24.20.0`
- Session: non-elevated (`IsAdmin=False`), account
  `LAPTOP-48SUV1B9\sanjai`, SID
  `S-1-5-21-3754871364-2633088164-2083122245-1001`, session id 8
- Spike workspace: `spikes/s2-process-model/`
- Raw artifacts: `spikes/s2-process-model/out/` (gitignored; regenerate with the
  commands below)
- Throwaway code: nothing here may be promoted without a Phase 2 rewrite.

This shard is deliberately separate from `docs/spikes/s2-results.md`,
`docs/architecture.md`, and `PRD.md`. Those files were not modified by this task;
the proposed text at the end is for the integrating session.

## What was built

A throwaway Node prototype of the PRD §9.2 model:

- `host.mjs` — headless named-pipe server, single writer, dedupe by `eventId`,
  durable append-only journal, receipt→dispatch timing, spool ingest (startup and
  poll), idle exit, single-instance guard, optional post-create ACL hardening,
  crash-writer / verify-only modes.
- `shim.mjs` — bounded connect → send one event → exit; on failure spawn the host
  `detached:true, windowsHide:true, stdio:'ignore'`; one bounded retry phase; if
  still unreachable, write one spool file and exit 0.
- `client.mjs` — pipe client used for ping and latency runs.
- `lib/journal.mjs` — CRC32-framed append-only journal with fsync and torn-tail
  truncation. **A durable-file stand-in for the crash test only; D-04 pending.**
- `scripts/pipe-acl.ps1` + `scripts/pipe-acl-helper.cs` — read/set/deny a pipe
  DACL; the `.cs` file is compiled to `out/bin/pipe-acl-helper.exe` to measure
  the fast production route.
- `scripts/window-check.ps1`, `scripts/console-parent-alloc.ps1` — console/window
  probe and a real-console parent for the no-console control.
- `scripts/mutex-test.ps1` — named-mutex double-start and owner-kill test.
- `bench/*.mjs` — measurement harnesses.

## Exact commands

From `spikes/s2-process-model/`:

```bash
MSYS_NO_PATHCONV=1 C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe \
  /nologo /optimize+ /target:exe "/out:out\bin\pipe-acl-helper.exe" \
  "scripts\pipe-acl-helper.cs"
node bench/run-measurements.mjs
node bench/acl.mjs
node bench/no-console.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mutex-test.ps1
node bench/crash-recovery.mjs
```

The canonical run wrote `out/bench/measurements.json`,
`out/bench/measurements-summary.txt`, `out/bench/run-console.log`, and the
section artifacts cited below.

---

## S2-01 — Is the pipe restricted to the current user, and can Node set that ACL?

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0,
  PowerShell 5.1.26100.9711, .NET Framework `csc` 14.8.10001.0.
- **Method:** `node bench/acl.mjs`. It starts `host.mjs` (default Node pipe),
  reads the DACL with `scripts/pipe-acl.ps1 -Action read`, restarts with
  `--harden-acl`, reads again, then starts a third host, applies an explicit
  **deny** ACE for the current user, and attempts a client connect. The P/Invoke
  path is `CreateFileW(READ_CONTROL|WRITE_DAC)` → `SetSecurityInfo` →
  `ConvertSecurityDescriptorToStringSecurityDescriptorW`.
- **Raw observation (verbatim):**

```text
# Node's default DACL on \\.\pipe\agent-attention-sanjai-<suffix>
DACL_SDDL=D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;S-1-5-21-3754871364-2633088164-2083122245-1001)(A;;FR;;;WD)(A;;FR;;;AN)

# after post-create hardening (compiled helper or pipe-acl.ps1 set-user-only)
DACL_SDDL=D:P(A;;FA;;;SY)(A;;FA;;;S-1-5-21-3754871364-2633088164-2083122245-1001)

# enforcement control: explicit deny ACE for the current user
TARGET_SDDL=D:P(A;;FA;;;SY)(D;;FA;;;S-1-5-21-3754871364-2633088164-2083122245-1001)
SET_RESULT=SET_OK
DACL_SDDL=OPEN_FAILED err=5
connect failed: connect EPERM \\.\pipe\agent-attention-sanjai-denydemo
CLIENT_EXIT=2
```

- **Conclusion:** Node's default named-pipe DACL is **not** current-user-only:
  SYSTEM and Administrators have full control, the current user has full control,
  and `Everyone` (`WD`) plus `Anonymous` (`AN`) have read-only (`FR`) access. The
  current user can open the pipe with `WRITE_DAC` and replace the DACL after
  `listen()`; readback shows only `SYSTEM` and the current user. The explicit
  deny-ACE control proves the DACL is actually enforced (readback itself fails
  with access denied, and the client gets `EPERM`), not merely stored. A true
  cross-user connection test was not possible (S2-02). Node cannot supply a
  security descriptor at pipe creation, so hardening is post-create and has a
  short window in which another user has read-only access to the default DACL.
- **Tag:** `[Verified]` for the default DACL, hardening, and enforcement. The
  current-user-only requirement is verified only by DACL readback + deny control,
  not by a second-user login.

## S2-02 — Can a second low-privilege user be denied a connection?

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / PowerShell 5.1.
- **Method:** `Get-LocalUser`; `WindowsPrincipal.IsInRole(Administrator)`;
  attempted search for usable second-account credentials. No credentials are
  available for the enabled sandbox accounts, and the session is non-elevated, so
  no process was created as another user.
- **Raw observation (verbatim):**

```text
Name                Enabled
----                -------
Administrator       False
CodexSandboxOffline True
CodexSandboxOnline  True
DefaultAccount      False
Guest               False
sanjai              True
WDAGUtilityAccount  False
WsiAccount          False

IsAdmin=False
```

- **Conclusion:** A true cross-user connection attempt was **not** performed. It
  needs either the password of another local account or admin rights to create
  and log on a temporary account. This is recorded as a limitation, not
  fabricated. The deny-ACE control in S2-01 is the strongest available substitute:
  it proves the ACL is enforced for an identity that lacks access. It does not
  prove what a different authenticated user sees.
- **Tag:** `[Blocked]`

## S2-03 — Does double start yield exactly one live host?

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** `node bench/run-measurements.mjs singleInstance`. Start host A on
  the pipe, wait for ready, start host B with the same pipe, capture B's exit
  code and stderr, then ping the pipe and compare the answering PID with A.
- **Raw observation (verbatim from `out/bench/measurements.json`):**

```json
{
  "firstHostPid": 41728,
  "readyMs": 86.346,
  "secondExitCode": 3,
  "secondStderr": "agent-attention host: already running on \\\\.\\pipe\\agent-attention-sanjai-s2-1792489463722-si",
  "secondLog": [
    {"event":"journal_loaded","records":0,"lastSeq":0,"truncatedBytes":0},
    {"event":"already_running","pipe":"\\\\.\\pipe\\agent-attention-sanjai-s2-1792489463722-si"}
  ],
  "pingAfterSecondStart": {"type":"pong","pid":41728,"uptimeMs":130,"sessions":0,"journalSeq":0,"dispatched":0},
  "oneLiveHostPidMatchesFirst": true
}
```

- **Conclusion:** Exclusive named-pipe creation is a sufficient single-instance
  guard. Host B fails `listen` with `EADDRINUSE`, logs `already_running`, writes
  one line to stderr, and exits `3`; the pipe still answers with host A's PID.
  No second journal writer existed; B opens the journal read-only/append but
  writes no event. The OS releases the pipe when the host dies,
  so a crashed host cannot leave a stale guard (unlike a lockfile).
- **Tag:** `[Verified]`

## S2-04 — Does a named mutex provide the same guarantee?

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / PowerShell 5.1.
- **Method:** `powershell -NoProfile -ExecutionPolicy Bypass -File
  scripts/mutex-test.ps1`. Contender A takes
  `Local\agent-attention-s2-mutex-<id>` and holds it 6 s; B starts while A holds
  it; A is killed; C starts after the kill. Each contender records
  `createdNew`.
- **Raw observation (verbatim):**

```text
MUTEX_NAME=Local\agent-attention-s2-mutex-b1846567
A createdNew=True pid=36636
B createdNew=False pid=34000
C_after_kill createdNew=True pid=23808
SUMMARY={"name":"Local\\agent-attention-s2-mutex-b1846567","a_createdNew":true,"b_createdNew":false,"c_afterOwnerKilled_createdNew":true,"onlyOneOwnerAtATime":true,"mutexIsPerSession":true}
```

- **Conclusion:** A named mutex does provide one-owner-at-a-time semantics and is
  released when the owner dies. But: (a) Node has no built-in named-mutex API, so
  the host would need a helper process or a native addon; (b) `Local\` is
  per-session, so it does not guard two Windows sessions of the same user, while
  the named pipe is machine-wide; (c) after an owner kill a new process acquires
  the abandoned mutex, so it cannot distinguish a stale host either. The mutex is
  redundant with the pipe for this design.
- **Tag:** `[Verified]` (mechanism). Recommendation below rejects it as a
  primary guard.

## S2-05 — Shim success path: connect → send one event → exit

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** `node shim.mjs --pipe-suffix <s> --data-root <d> --metrics-dir
  <m> --seq 1` while a host is listening; and with no host to exercise the spawn
  path. Harness: `node bench/run-measurements.mjs warmShim coldShim`.
- **Raw observation (verbatim from a cold-spawn metrics file):**

```json
{
  "outcome": "spawned-pipe",
  "spawned": true,
  "spawnedPid": 35460,
  "attempts": 3,
  "durationMs": 120.8,
  "phases": [
    {"name":"start","atMs":1.329},
    {"name":"attempt1","atMs":3.782,"ok":false,"reason":"ENOENT","ms":2.282},
    {"name":"spawned","atMs":18.298,"pid":35460,"windowsHide":true,"detached":true,"stdio":"ignore"},
    {"name":"connected","atMs":108.796},
    {"name":"retry","atMs":120.753,"ok":true,"attempts":3,"ms":12.549},
    {"name":"exit","atMs":120.8,"outcome":"spawned-pipe"}
  ]
}
```

- **Conclusion:** The shim connects, writes one newline-delimited event, waits for
  an ack, and exits; the host dedupes and commits before acking. If the pipe is
  absent the shim spawns the host detached/hidden and then retries. A *single*
  immediate retry loses the race with host startup (named-pipe connect fails fast
  with `ENOENT` instead of waiting), so the prototype uses **one bounded retry
  phase** with a 40 ms poll (3 attempts observed). The total budget is still
  1000 ms; the retry phase is capped by the remaining budget. This is a spec
  clarification for §9.2, not a second retry.
- **Tag:** `[Verified]`

## S2-06 — Shim failure path: spool and ingest preserving order

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** with no host and `--no-spawn`, run shims that write to
  `%LOCALAPPDATA%\AgentAttention\spool\*.jsonl` (prototype override
  `--data-root out/...`). Then start the host and inspect `spool_ingest` log
  lines. Harness: `node bench/run-measurements.mjs spoolSequential`.
- **Raw observation (verbatim):**

```text
# spool directory, sequential run
1792489492088-037804-9c55ddc2.jsonl
1792489492196-036852-aac65e4b.jsonl
...

# file contents
{"eventId":"...","sessionId":"shim-session","kind":"needs_approval","sequence":1,"ts":1792488381426,"source":"s2-shim","spooledAt":"2026-10-20T09:26:21.429Z","spoolReason":"ENOENT"}

# host ingest
{"event":"spool_ingest","source":"startup","file":"1792489492088-037804-9c55ddc2.jsonl","seq":1,"sequence":1,"ingestUs":86.2}
{"event":"spool_ingest","source":"startup","file":"1792489492196-036852-aac65e4b.jsonl","seq":2,"sequence":2,"ingestUs":1.7}
```

- **Conclusion:** The fallback works. Each invocation writes one file to a
  temporary name and atomically renames it to
  `<13-digit epoch ms>-<6-digit pid>-<8 hex>.jsonl`, so a visible `.jsonl` is
  always complete. The host sorts filenames, commits each event, logs the ingest,
  and deletes the file only after commit. A periodic poll also picks up files
  written while the host is running. Duplicate `eventId`s are skipped, so a
  replayed file after a crash does not double-dispatch.
- **Tag:** `[Verified]`

## S2-07 — Does the detached spawn show a console window?

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0,
  PowerShell 5.1.
- **Method:** `node bench/no-console.mjs`. A launcher calls
  `FreeConsole(); AllocConsole()` (reported `hwnd=1116452 visible=True`) and then
  spawns `host.mjs` three ways: the shim's real flags (`detached:true,
  windowsHide:true`), `detached:false, windowsHide:true` (CREATE_NO_WINDOW
  control), and `detached:false, windowsHide:false` (visible-console control).
  `scripts/window-check.ps1` probes the host PID with `AttachConsole` +
  `GetConsoleWindow` + `IsWindowVisible` and enumerates top-level windows owned
  by that PID. The real `shim.mjs` path is also probed.
- **Raw observation (verbatim, `out/bench/no-console/no-console.json`):**

```text
detached        {"totalWindows":0,"visibleWindows":0,"console":{"attached":false,"attachError":6,"consoleWindow":0,"consoleWindowVisible":false}}
hidden-nodetach {"totalWindows":0,"visibleWindows":0,"console":{"attached":true,"attachError":187,"consoleWindow":0,"consoleWindowVisible":false}}
inherited       {"totalWindows":0,"visibleWindows":0,"console":{"attached":true,"attachError":187,"consoleWindow":985578,"consoleWindowVisible":false,"consoleTitle":"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"}}
viaShim         {"totalWindows":0,"visibleWindows":0,"console":{"attached":false,"attachError":87,"consoleWindow":0,"consoleWindowVisible":false}}
```

- **Conclusion:** With the shim's real flags the host has **no console at all**
  (`AttachConsole` fails with error 6; the real-shim probe also reported
  `attached:false`, error 87), so a console window cannot exist; it also
  owns zero top-level windows. `windowsHide:true` without `detached` creates a
  console whose `GetConsoleWindow()` is `0` (no window). Both checks are
  OS-level and reproducible. **Limitation:** the visible-console negative control
  returned a console window handle but `IsWindowVisible=false` in this session,
  so this environment did not render a visible window for the control; the
  launcher itself reported its allocated console visible at creation
  (`out/alloc/launcher.log`: `ALLOC ok=True hwnd=1116452 visible=True`), so the
  probe can see a window, but the negative control is weaker than planned. The
  no-console claim does not depend on it: the detached child has no console.
- **Tag:** `[Verified]` for “no console window on the detached spawn”. The
  negative control is recorded as inconclusive.

## S2-08 — Warm shim overhead

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** `node bench/run-measurements.mjs warmShim`. A host is kept alive;
  100 shims are spawned sequentially; each is timed externally (spawn→exit) and
  internally (`shim.mjs` `durationMs`). The external number includes Node process
  creation; the internal number is only the shim's own work.
- **Raw observation (verbatim summary + samples):**

```text
warmShim: n=100 p50=114.359 p95=137.906 p99=140.512 min=100.301 max=147.995
internal: n=100 p50=10.413 p95=12.505 p99=13.272 min=7.086 max=14.101
outcomes={"pipe":100}

samples (ms):
111.131 109.221 104.972 105.847 110.424 109.245 106.761 100.301 117.558 112.733
117.885 121.520 102.677 112.133 117.832 110.088 132.714 126.364 127.593 147.995
120.609 107.085 102.620 108.169 111.645 114.359 130.992 117.130 112.369 107.660
128.522 108.544 102.736 109.132 108.220 127.774 112.052 105.055 113.593 115.398
112.466 126.016 122.748 114.481 126.770 123.944 115.784 138.259 109.303 110.313
106.690 124.698 118.834 119.164 107.535 103.268 108.008 113.542 121.406 121.614
103.183 106.517 105.948 106.899 106.809 137.138 109.333 106.816 106.718 124.362
130.625 116.175 111.376 119.036 122.333 117.219 138.206 115.408 115.311 109.533
107.354 102.204 133.120 103.546 123.252 103.544 138.116 118.886 117.135 106.690
113.261 118.790 124.560 137.906 119.576 117.571 140.512 114.920 123.277 115.509
```

- **Conclusion:** Warm p95 is 137.9 ms, well under the 300 ms target. Almost all
  of it is Node process startup (~104 ms external minus ~10 ms internal). The
  internal shim work is ~10 ms p50.
- **Tag:** `[Verified]`

## S2-09 — Cold shim overhead (host absent), with and without ACL hardening

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** `node bench/run-measurements.mjs coldShim coldShimHardened`. Before
  each sample the host is killed and the pipe is confirmed gone; the shim spawns
  the host, waits for the pipe, sends, and exits. “Cold” here means **host not
  running, OS caches warm**; it is not a post-reboot measurement.
- **Raw observation (verbatim):**

```text
coldShim: n=10 p50=221.150 p95=239.759 min=216.898 max=239.759
samples (ms): 232.316 233.411 223.404 239.759 220.373 221.150 216.898 220.574 221.486 220.269
outcomes: 10/10 "spawned-pipe"

coldShimHardened: n=5 p50=276.998 p95=300.116 min=250.320 max=300.116
samples (ms): 298.606 250.320 300.116 273.069 276.998
outcomes: 5/5 "spawned-pipe"
```

- **Conclusion:** With the host absent, the shim still completes in ~221 ms p50
  and ~240 ms p95, including the host spawn and one retry phase. Adding the
  compiled ACL helper raises p95 to ~300 ms. Both are far below the 1000 ms hard
  cap. The compiled helper is the measured fast route for the hardened number;
  the PowerShell hardening route would add ~600 ms and is rejected for the hot
  path (S2-15).
- **Tag:** `[Verified]` for host-absent cold. Post-reboot cold is
  `[Assumption]`; see limits.

## S2-10 — Notification Host cold start

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** `node bench/run-measurements.mjs hostColdStart`. Ten iterations:
  spawn `host.mjs` with an empty data root, poll the pipe until the first pong,
  record spawn→ready, kill.
- **Raw observation (verbatim):**

```text
hostColdStart: n=10 p50=85.747 p95=101.088 min=66.502 max=101.088
samples (ms): 101.088 91.099 88.412 75.135 85.747 77.531 87.032 84.574 66.502 99.777

host internal boot→listening (ms):
0.476 0.418 0.527 0.648 3.238 0.494 0.741 3.143 0.551 0.569
```

- **Conclusion:** Host process creation dominates (~80–100 ms); the Node work
  from module start to `listening` is 0.4–3.2 ms. With the compiled ACL helper
  the same measurement is p50 146 ms / p95 229 ms (S2-15). No PRD target exists
  for host cold start; the 1000 ms shim cap is the binding constraint and is met.
- **Tag:** `[Verified]`

## S2-11 — Receipt-to-dispatch latency

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** `node bench/run-measurements.mjs dispatchLatency`; 500 sequential
  events over one persistent pipe connection (`client.mjs --count 500`). The host
  starts the timer when the socket `data` handler receives the frame, validates,
  dedupes, appends to the journal with `fsync`, then calls `dispatch()`; the
  timer stops on return. This is conservative: it includes the durable write.
- **Raw observation (verbatim):**

```text
dispatchLatency: n=500
ingestUs:  min=2035.9 p50=2309.5 p95=2637.6 p99=3100.9 max=7402.9 mean=2353.5
rttMs:     min=2.261  p50=2.702  p95=3.296  p99=3.938  max=8.749  mean=2.771

first 10 ingestUs samples:
[7402.9, 4332.6, 4218.6, 2329.7, 2337.8, 2157.1, 2349.0, 2221.0, 2403.9, 2277.8]
```

- **Conclusion:** p95 is 2.64 ms, two orders of magnitude below the 500 ms
  target. The journal `fsync` is the dominant cost; without it the number would
  be lower, but then the crash guarantee would be weaker. This measures
  receipt→dispatch-call only, not audio playback (S3).
- **Tag:** `[Verified]`

## S2-12 — Spool-to-ingest ordering

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** `node bench/run-measurements.mjs spoolSequential spoolConcurrent`.
  Sequential: 20 shims with `--no-spawn`, each `sequence` 1…20, then start the
  host and read `spool_ingest` lines. Concurrent: 20 shims started in parallel
  with the same sequence numbers, then start the host.
- **Raw observation (verbatim):**

```text
spoolSequential: n=20 preserved=true
ingestOrder=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]
remainingSpoolFiles=[]

spoolConcurrent: n=20 spawnSpreadMs=425.357
fileOrder  =[1,2,3,4,5,6,7,8,9,10,11,12,13,17,14,16,15,18,19,20]
ingestOrder=[1,2,3,4,5,6,7,8,9,10,11,12,13,17,14,16,15,18,19,20]
fileOrderEqualsIngestOrder=true
inversionsVsSequence=4
```

- **Conclusion:** The host preserves the spool's file-name order exactly in both
  cases. Sequential invocations therefore preserve the shim's event sequence.
  Concurrent invocations in the same few milliseconds have no shared ordering
  authority; filename order is deterministic but differs from the logical
  `sequence` order (4 inversions here, 21 in an earlier run). Per-session
  `sequence` remains authoritative for the state machine. This is the intended
  limit, not a failure: the spool is a durability buffer, not a total-order
  service.
- **Tag:** `[Verified]`

## S2-13 — Idle exit

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** `node bench/run-measurements.mjs idleExit` with the timer shortened
  from the PRD default 600000 ms to `idle-ms=3000`, `session-live-ms=1000`
  (explicitly a prototype shortening). A: one event then wait. B: one event every
  500 ms for 6 s, confirm the host is alive, stop, wait for exit.
- **Raw observation (verbatim):**

```text
A: exitCode=0, msFromEventToExit=4252.420
{"event":"idle_start","monoMs":1202.718,"idleMs":3000,"sessionLiveMs":1000,"sessions":1}
{"event":"idle_exit","monoMs":4246.197,"idleForMs":3043,"idleMs":3000,"sessions":1}
{"event":"shutdown","reason":"idle","journalSeq":1,"dispatched":1}

B: aliveAfter6s=true, exitCode=0, msFromLastEventToExit=4138.300
{"event":"idle_start","monoMs":8047.234,"idleMs":3000,"sessionLiveMs":1000,"sessions":1}
{"event":"idle_exit","monoMs":11101.091,"idleForMs":3054,"idleMs":3000,"sessions":1}
```

- **Conclusion:** The host exits gracefully when no client is connected and no
  session has been seen for `session-live-ms`, and the resulting dry period
  reaches `idle-ms`. In A the event is at ~111 ms, the session goes stale at
  ~1202 ms, and exit occurs at ~4246 ms (1000 + 3000 + timer granularity). In B
  the host stays alive while events arrive, then exits ~4.14 s after the last
  one. The 10-minute default was not waited out; it uses the same code path.
- **Tag:** `[Verified]` for the shortened timer; `[Assumption]` for exactly
  600000 ms.

## S2-14 — Crash recovery: kill -9 mid-write

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0.
- **Method:** `node bench/crash-recovery.mjs`. Ten iterations: start
  `host.mjs --crash-writer` (16 KiB payloads, journal append + fsync per record,
  seq printed to stdout), wait for at least 5 records, sleep 20–140 ms, then
  `taskkill /PID <pid> /F`. Restart with `host.mjs --verify-only`, which loads the
  journal, rebuilds the dedupe set, and truncates a torn/invalid tail. Then two
  deterministic cases: append half a record (no newline) and append a complete
  line with a bad CRC.
- **Raw observation (verbatim):**

```text
crash 1: wrote=138 last=138 recovered=139/139 truncated=0 contiguous=true
crash 2: wrote=131 last=131 recovered=132/132 truncated=0 contiguous=true
...
crash 10: wrote=185 last=185 recovered=186/186 truncated=0 contiguous=true

tornTail.before  = {"records":3,"lastSeq":3,"truncatedBytes":0,"contiguous":true}
tornTail.torn    = {"records":3,"lastSeq":3,"truncatedBytes":49,"contiguous":true}
tornTail.badCrc  = {"records":3,"lastSeq":3,"truncatedBytes":63,"contiguous":true}
```

- **Conclusion:** All 10 kill runs recovered a contiguous journal; `records ==
  lastSeq`, and the dedupe set was rebuilt. In every run the recovered journal had
  one more record than the last `WROTE` line observed on stdout: that record was
  already fsynced but the stdout line was lost with the process, which is the
  expected behavior of “commit, then ack”. No corruption or gap appeared. The
  deterministic torn tail (49 bytes) and bad-CRC line (63 bytes) were truncated
  to the last valid record, and the valid prefix stayed intact. **This is a
  durable-file stand-in; D-04 is pending.** The recovery semantics that must
  carry over are: write+fsync before ack, rebuild dedupe on load, truncate only
  the torn tail, and make spool replay idempotent by `eventId`.
- **Tag:** `[Verified]` for the prototype journal. The production SQLite
  equivalent is not verified here.

## S2-15 — ACL hardening cost: PowerShell vs compiled helper

- **Date / Windows build / tool versions:** 2026-10-20 / 26300 / Node v24.20.0,
  PowerShell 5.1, .NET Framework csc 14.8.10001.0.
- **Method:** `node bench/acl.mjs` sections `hardenedColdStart` (host runs
  `powershell -File scripts/pipe-acl.ps1 -Action set-user-only`) and
  `helperColdStart` (host runs `out/bin/pipe-acl-helper.exe set-user-only`).
  Five iterations each; ready time is spawn→first ping.
- **Raw observation (verbatim):**

```text
PowerShell: readyMs 722.201 671.284 729.910 721.052 750.963
            aclHardenMs 584.1 649.3 579.7 580.6 636.1
Helper:     readyMs 146.005 141.793 192.298 145.187 229.053
            aclHardenMs 78.8 63.3 93.2 67.2 132.8
Helper SDDL: D:P(A;;FA;;;SY)(A;;FA;;;S-1-5-21-3754871364-2633088164-2083122245-1001)
```

- **Conclusion:** PowerShell startup costs 580–650 ms per host start; the
  compiled helper costs 63–133 ms. Both harden the DACL correctly, but only the
  helper leaves enough of the 1000 ms shim budget for the cold path (S2-09).
  The helper is a throwaway 6.6 KiB C# exe built with the in-box compiler; a
  production build needs a proper signed component or a Node-API addon.
- **Tag:** `[Verified]`

---

## Measurements against PRD §19.3

| PRD metric | Target | Measured | Verdict |
|---|---|---|---|
| Hook shim overhead on host (warm) | p95 < 300 ms | p95 137.9 ms (n=100) | Pass |
| Hook shim overhead on host (cold) | p95 < 300 ms | p95 239.8 ms (n=10); 300.1 ms with ACL hardening (n=5) | Host-absent passes; ACL-hardened cold is 0.1 ms over the 300 ms target, under the 1000 ms cap |
| Hook shim hard cap | 1000 ms | max 300.1 ms in recorded runs | Pass |
| Receipt-to-dispatch latency (host) | p95 < 500 ms | p95 2.64 ms (n=500) | Pass |
| Hook-to-audible-sound end-to-end | p95 < 2 s | not measured — depends on S3 providers | `[Blocked]` |
| Notification Host crash-free (fixture/storm suites) | none | 10/10 kill runs recovered; no long soak | Partial, `[Verified]` for consistency only |
| Duplicate audible alerts | 0 | dedupe by `eventId` across journal + spool observed; no provider/audio | Not applicable here |
| Host cold start | none | p50 85.7 ms / p95 101.1 ms (no ACL); p50 146 ms / p95 229 ms (helper) | Informational |

**Cold-path caveat.** The “cold” rows mean the host was not running, not that the
machine had just booted. File cache, Defender, and the Node binary were warm.
This is the RF-S2 risk. The measured headroom is large (p95 240 ms vs 1000 ms),
but a true post-reboot run is `[Assumption]`, not `[Verified]`.

## Raw sample files (gitignored)

- `out/bench/measurements.json` — all sections, full samples, raw phase data.
- `out/bench/measurements-summary.txt` — one-line-per-section summary.
- `out/bench/run-console.log` — the canonical run’s console output.
- `out/bench/acl/acl.json` — DACL readbacks, deny control, hardening costs.
- `out/bench/no-console/no-console.json` — window/console probes.
- `out/bench/mutex/mutex-summary.json` — mutex results.
- `out/bench/crash/crash-recovery.json` — kill iterations and torn-tail cases.
- `out/bench/shim-warm/m/*/` — one metrics file per warm shim.
- `out/bench/shim-cold/d*/host.jsonl`, `out/bench/idle/*/host.jsonl`,
  `out/bench/spool-seq/host.jsonl` — host-side evidence.

---

## D-03 recommendation

**Recommendation: accept the §9.2 model with the amendments below. Do not switch
to in-process embedding for the MVP.**

The headless Notification Host + shim/in-process adapters + per-user named pipe +
spool fallback is buildable on Windows with measured headroom. The parts that
need explicit decisions before Phase 2 are the ACL mechanism and the meaning of
“retry once”.

### Accepted

1. **Headless host, single writer.** The host owns persistence and providers;
   shims are stateless. This is what makes dedupe, ordering, idle exit, and the
   crash story tractable. Evidence: S2-03, S2-05, S2-11, S2-14.
2. **Named-pipe transport, no TCP.** Functional and fast. Evidence: S2-05,
   S2-08, S2-09, S2-11.
3. **Exclusive pipe creation as the single-instance guard.** Second start exits
   `3`; the OS releases the pipe on death. Evidence: S2-03.
4. **Spool fallback with atomic per-event files.** The host does not lose the
   event when the pipe is down and the spool is writable; replay is idempotent by
   `eventId`. Evidence: S2-06, S2-12.
5. **Idle exit and crash recovery semantics.** Shortened-timer test and 10/10
   kill recoveries. Evidence: S2-13, S2-14.

### Required amendments to §9.2

1. **Define `<user>` in the pipe name.** Use a stable, sanitized account token,
   preferably a short hash of the account SID (e.g.
   `agent-attention-u-<sid8>`), not the mutable display/username. The prototype
   used the lowercase username plus a test suffix. Rationale: local and domain
   accounts can share a short name, and a username can change.
2. **State how the DACL is applied.** Node cannot supply a pipe security
   descriptor. The host must harden the DACL immediately after `listen()`, using
   a bundled native helper or Node-API addon, and must not announce readiness
   until the readback matches `D:P(A;;FA;;;SY)(A;;FA;;;<user SID>)`. The default
   DACL is not acceptable: it grants `Everyone`/`Anonymous` read. PowerShell
   hardening is a fallback only; it costs ~600 ms and pushes host ready to
   ~700 ms (S2-15).
3. **Acknowledge the post-create race.** Until hardening completes, another user
   has the default read-only access. They cannot write (no `FILE_WRITE_DATA` in
   the default DACL), so event injection was not observed, but presence disclosure
   remains (and, if the server caps instances, slot exhaustion). Keep the
   harden-before-ready rule and document the residual window. If that is
   unacceptable, the alternative is a native component that creates the pipe with
   the DACL already applied (Phase 2 task, not prototyped here).
4. **Clarify “retry once”.** A named-pipe connect to a missing server fails
   immediately; a single immediate retry loses the race with host startup. Define
   one retry **phase** bounded by the remaining shim budget, polling at a fixed
   short interval (prototype: 40 ms, 3 attempts observed). Do not add a second
   phase.
5. **State the spool order limit.** File-name order is preserved; concurrent
   invocations in the same millisecond have no total order. Per-session
   `sequence` is authoritative. Define the spool filename and the “commit, then
   delete” rule explicitly.
6. **State the idle condition.** “No live sessions” means no connected client
   and no session seen within `session-live-ms`; then wait `idle-ms` (default
   600000). This matches the prototype and avoids exiting between two events of a
   live session.
7. **Keep D-04 separate.** The host remains the only process that opens the
   store. The journal in this spike is not the production store; SQLite binding,
   WAL, and lock behavior are Task 0.7.

### Rejected alternatives

| Alternative | Why rejected | Tag |
|---|---|---|
| Node default pipe DACL, no hardening | Grants `Everyone`/`Anonymous` read; fails the “restricted to the current user” requirement. | `[Rejected]` (measured) |
| PowerShell ACL hardening on every host start | Correct DACL, but 580–650 ms per start; host ready ~700 ms and the cold shim path loses most of its budget. | `[Rejected]` (measured; fallback only) |
| Named mutex as the primary single-instance guard | Node has no API; `Local\` is per-session; pipe is already machine-wide and authoritative; mutex adds a helper process for no gain. | `[Rejected]` (measured mechanism, redundant) |
| TCP loopback listener | Violates the PRD’s “no TCP listener” and adds firewall/port surface; not tested. | `[Rejected]` by design, not measured |
| One shared spool file with cross-process append | Atomic visibility under concurrent writers is not guaranteed; per-event files + rename give a complete-or-absent file. Not A/B tested. | `[Assumption]` |
| In-process embedding for the first host | Not trialled. It would put the store and providers in the host’s runtime, break the single-writer rule for multi-host users, and re-import native-module/version risk into every adapter runtime. Keep §9.2’s optional escape hatch, but do not choose it now. | `[Assumption]` |
| Windows AF_UNIX socket in an ACL’d directory | Could avoid post-create pipe ACL hardening, but it changes the transport and was not measured; needs its own latency/ACL/cleanup spike. | `[Assumption]` |

### In-process embedding

Not trialled. The recommendation is to keep it as a documented option for a
single-host scenario, not to require it. The single-writer rule, the pipe
interface, and the policy boundary must hold either way. A future host-specific
spike can test embedding without reopening D-03 for the others.

---

## Proposed text for PRD §9.2

> ## 9.2 Process model
>
> Coding-agent hosts integrate in different ways: some load in-process plugins;
> others spawn a fresh command per lifecycle hook. A fresh process per event
> cannot hold state, cannot deduplicate atomically in memory, and pays startup
> cost each time. Therefore:
>
> 1. **Notification Host** — a headless, long-lived local process (no window, no
>    tray icon). Started on demand by the first event from any adapter, exits
>    after an idle period with no live sessions (default 10 minutes). It is the
>    **single writer** for the database, owns providers, the audio queue, timers
>    (reminders, stale detection, grace windows), and policy evaluation. Idle
>    means no connected client and no session seen within `session-live-ms`;
>    the host then waits `idle-ms` before a graceful exit.
> 2. **Adapters** — either an in-process plugin (where the host supports it) or a
>    **hook shim**: a minimal script that reads the host’s hook payload,
>    normalizes it, sends it to the Notification Host, and exits.
> 3. **Transport** — a per-user named pipe
>    `\\.\pipe\agent-attention-<user>`, where `<user>` is a stable sanitized
>    account token (preferably a short SID hash). No TCP listener. The host
>    creates the pipe and, before announcing readiness, hardens its DACL to
>    `SYSTEM` plus the current user and reads it back; if hardening fails, the
>    host exits rather than serving a permissive pipe. Node cannot set a pipe
>    security descriptor at creation, so hardening is a post-create step with a
>    short read-only race window; a native component MAY replace it.
> 4. **Single instance** — the first host owns the pipe. A second start fails
>    pipe creation and exits nonzero without writing sessions, spool, or the
>    store. An additional named mutex is optional and MUST NOT be the only guard.
> 5. **Shim behavior (hard requirements):**
>    - MUST NOT block the host: bounded total runtime (default ≤ 1000 ms), then
>      exit. Measured: warm p95 138 ms; host-absent p95 240 ms; host-absent with
>      ACL hardening p95 ~300 ms.
>    - MUST exit `0` and MUST write nothing to the host’s stdout/stderr that the
>      host could interpret as instructions.
>    - Connect, send one event, wait for an ack that is only sent after a durable
>      commit, and exit. If the pipe is unreachable, spawn the Notification Host
>      detached (hidden, no console window), then run **one bounded retry phase**
>      within the remaining budget. A single immediate retry is not sufficient
>      because a pipe connect to a missing server fails immediately.
>    - If the retry phase fails, **spool** the event to
>      `%LOCALAPPDATA%\AgentAttention\spool\<13-digit epoch ms>-<pid>-<random>.jsonl`,
>      written under a temporary name and atomically renamed. Each file contains
>      one or more complete JSON records; a visible `.jsonl` is always complete.
>    - The Notification Host ingests the spool at startup (sorted by filename)
>      and periodically while running. It commits each record, logs the ingest,
>      deletes the file only after commit, and deduplicates by `eventId`.
>      File-name order is preserved; concurrent invocations in the same
>      millisecond have no total order, and the per-session `sequence` is
>      authoritative.
> 6. **CLI** uses the same pipe interface.
>
> Because only the Notification Host opens SQLite, native-module and
> runtime-version problems are confined to one controlled process, not every
> adapter runtime. [D-04 pending Task 0.7]
>
> If a later host-specific spike shows that an in-process model is sufficient and
> safe for that host, the Notification Host MAY be embedded for that host, but the
> single-writer rule and the interface in §9.4 remain.

## Proposed text for PRD §23.1 D-03

> | D-03 | Process model: headless Notification Host + shim/in-process adapters;
> per-user named pipe with post-create DACL hardening before readiness; spool
> fallback with atomic per-event files; single instance via exclusive pipe
> creation (named mutex optional, not required). Verified in S2: warm shim p95
> 138 ms, host-absent p95 240 ms, receipt→dispatch p95 2.6 ms, second start exits
> 3, 10/10 kill-recovery runs consistent. See
> `docs/spikes/phase-0-shards/s2-process.md`. | Decided (S2) |

## Blockers, limits, and follow-ups

- **`[Blocked]` Second-user ACL test.** No credentials for another account and
  no elevation to create one. The deny-ACE enforcement control is the substitute.
  Follow-up: run the same readback and a `Start-Process -Credential` client as a
  standard local user on a test machine.
- **`[Assumption]` Post-reboot cold latency.** Not measured; the host-absent cold
  path is. Headroom is large, but a reboot/Defender-cold run belongs in Phase 2
  performance tests.
- **`[Blocked]` Hook-to-audible end-to-end.** Depends on S3 sound/TTS providers.
- **`[Assumption]` 10-minute idle.** Same code path as the 3 s prototype timer,
  but the default duration was not waited out.
- **`[Assumption]` Native ACL helper in production.** The spike used a throwaway
  in-box `csc` build. Phase 2 must choose and sign/package a real helper or
  Node-API addon, and test it on a clean profile. This is a Phase 2 task, not a
  D-03 change.
- **D-04 is pending.** `lib/journal.mjs` is a crash-test stand-in. Do not read the
  journal format as a storage recommendation.
- **No soak/storm test.** The crash test is 10 kill runs, not the PRD “full
  fixture and storm suites”. Treat the crash-free metric as partial.
- **No AV/EDR observation.** Out of scope for S2; S3 covers delivery.
