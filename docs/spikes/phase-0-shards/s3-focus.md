# S3 Focus — foreground detection and click-to-focus (Task 0.11)

Status: **PARTIAL** — Q-06 answered; Q-07 verified for the no-input property and
window-management routes, but the exact toast-activation grant is blocked on the
0.10 toast registration (not present on this branch).

- Date: 2026-10-20
- Windows: 10.0.26300.0, DisplayVersion 26H2 (Windows 11)
- PowerShell: 5.1.26100.9711
- Windows Terminal: 1.24.12741.0 (`Microsoft.WindowsTerminal_1.24.12741.0_x64__8wekyb3d8bbwe`)
- Hosts exercised: Windows Terminal (dedicated test windows), VS Code (two existing
  windows), classic console host (`conhost.exe` + `cmd.exe`)
- Scripts: `spikes/s3-windows-delivery/focus/`
- Raw captures: `spikes/s3-windows-delivery/out/focus/` (gitignored)
- Desktop state: interactive, live user session. Other applications (Edge, Android
  emulator, Quick Settings) repeatedly changed the foreground during the runs. All
  observations below are what was measured under that contention; no result was
  idealized.

## Method

| Script | Role |
|---|---|
| `Get-ForegroundWindow.ps1` | `GetForegroundWindow` + `GetWindowThreadProcessId` + title/class/ancestors; one JSON object per sample. Read-only. |
| `Get-WindowInventory.ps1` | visible top-level window inventory (`-AsJson` for machine use). Read-only. |
| `Get-ProcessWindows.ps1` | all top-level windows of a PID, including hidden ones. Diagnostic. |
| `Focus-Window.ps1` | focus attempts: `plain`, `attach` (target thread), `attachfg` (foreground thread), `switch`, `allow`, `uia`. Window-management APIs only. |
| `FocusHarness.ps1` | WinForms canary that logs KeyDown/KeyPress/KeyUp/MouseDown, optionally performs a delayed/triggered focus attempt from inside the foreground process. |
| `Invoke-FocusMethods.ps1` | method matrix against a background canary. |
| `Invoke-HostDetection.ps1` | foreground identity per host + session→host ancestry. |
| `Invoke-WtTopology.ps1` | WT window/PID topology, tabs/panes, `GetConsoleWindow` mapping. |
| `Invoke-ClickToFocus.ps1` | click-to-focus model: foreground-granted activator → `SetForegroundWindow(target)`, key logging. |
| `Close-TestWindow.ps1`, `Stop-MarkerSessions.ps1` | cleanup of test windows/sessions only. |

None of the scripts contains `SendInput`, `keybd_event`, `SendKeys`, or a
`PostMessage`/`SendMessage` keystroke. `Close-TestWindow.ps1` posts only `WM_CLOSE`
to windows created by this spike.

---

## S3-F1 — Can a background helper focus a window, and does it send input?

- **Date / build / tools:** 2026-10-20; 10.0.26300.0 (26H2); PowerShell 5.1.26100.9711; interactive session.
- **Method:** `powershell -NoProfile -ExecutionPolicy Bypass -File focus/Invoke-FocusMethods.ps1` from `spikes/s3-windows-delivery`. Canary `FocusHarness.ps1 -DurationSeconds 45`; each method invoked in a fresh background `powershell.exe`. Capture: `out/focus/methods-transcript.txt`, `out/focus/method-*.json`, `out/focus/methods-summary.json`.
- **Raw observation (verbatim, one line per method):**

  ```
  method=plain      targetIsForeground=false  errors=["SetForegroundWindow returned false, lasterr=0"]
  method=attach     targetIsForeground=false  errors=["SetForegroundWindow returned false, lasterr=0"]
  method=attachfg   targetIsForeground=true   errors=[]
  method=switch     targetIsForeground=false  errors=[]
  method=allow      targetIsForeground=false  errors=["AllowSetForegroundWindow(ASFW_ANY) failed, lasterr=5","SetForegroundWindow returned false, lasterr=5"]
  method=uia        targetIsForeground=false  errors=["UIA SetFocus threw: ... Target element cannot receive focus."]
  canary keystrokes: 0
  ```

  `attachfg` result: `"foregroundBefore":"0x2A07CA"`, `"foregroundAfter":"0x208FE"`,
  `"targetIsForeground":true`. The restore call using `attachfg` also succeeded
  (`"foregroundAfter":"0x30726"`, `targetIsForeground:true`).
- **Conclusion:** A background process cannot move the foreground while another
  application holds a fresh foreground (`plain`, `attach`, `allow`, `switch`, UIA
  all failed). Attaching to the **current foreground thread** (`attachfg`) then
  calling `SetForegroundWindow` succeeded 2/2 in this run and 2/2 in the restore
  path. `switch` returned without error but did not change the foreground. UIA
  `SetFocus` on a plain WinForms window threw "Target element cannot receive focus".
  The canary received zero keystrokes and zero mouse events across all attempts.
- **Tag:** [Verified] (on this build, under a live foreground lock).

## S3-F2 — Foreground → process/window mapping per host

- **Date / build / tools:** 2026-10-20; 10.0.26300.0 (26H2); PowerShell 5.1; interactive.
- **Method:** `Invoke-HostDetection.ps1`; dedicated WT window `S3-WT-TAB-A`, dedicated classic console (`conhost.exe cmd.exe /k fixtures/conhost-session.cmd`, title `S3-CONHOST-SESSION`), and the two existing VS Code windows. For each window: `attachfg`, then 5 foreground samples 200 ms apart. Capture: `out/focus/host-detection.json`, `out/focus/detection-transcript.txt`.
- **Raw observation (verbatim):**

  ```
  WT window:      {"hwnd":"0x13098A","pid":32364,"process":"WindowsTerminal","class":"CASCADIA_HOSTING_WINDOW_CLASS","title":"S3-WT-TAB-A"}
  console window: {"hwnd":"0x1008BA","pid":39560,"process":"cmd","class":"ConsoleWindowClass","title":"S3-CONHOST-SESSION"}
  VS Code windows:
    {"hwnd":"0x3D0782","pid":23044,"process":"Code","class":"Chrome_WidgetWin_1","title":"Pocket - Visual Studio Code"}
    {"hwnd":"0x10630","pid":23044,"process":"Code","class":"Chrome_WidgetWin_1","title":"03-phase-2-host-and-providers.md - agent-attention - Visual Studio Code"}
  WT tab A session pid=21172 ancestry=powershell.exe:21172 <- WindowsTerminal.exe:32364
  console session  pid=39560 ancestry=cmd.exe:39560 <- conhost.exe:36412
  windows-terminal:  focus targetIsForeground=True;  stable 5/5
  vscode-window-1:   focus targetIsForeground=False; stable 0/5   (foreground was an unrelated WT window opened by the user mid-run)
  vscode-window-2:   focus targetIsForeground=True;  stable 5/5
  classic-console:   focus targetIsForeground=True;  stable 5/5
  same-PID multi-window groups: {"pid":"23044","windows":["0x10630 :: ...","0x3D0782 :: ..."]}
  ```

- **Conclusion:** `GetForegroundWindow` → `GetWindowThreadProcessId` resolves the
  owning process reliably (15/15 stable samples for the three windows that could be
  focused). The VS Code window-1 sample is a **test-interference false negative**,
  not a detector failure: another WT window created during the run held the
  foreground. Two distinct VS Code top-level windows share one PID (23044), so
  *PID-only* matching cannot tell them apart.
- **Tag:** [Verified].

## S3-F3 — Windows Terminal topology: windows, tabs, panes, and session→HWND

- **Date / build / tools:** 2026-10-20; 10.0.26300.0 (26H2); Windows Terminal 1.24.12741.0.
- **Method:** `Invoke-WtTopology.ps1`:
  1. two separate `wt.exe -w new` windows, each running a fixture;
  2. one `wt.exe -w new new-tab … ; new-tab … ; split-pane -V …` window with three sessions;
  3. `fixtures/wt-probe-console.ps1` run inside a WT tab, calling `GetConsoleWindow()` and walking `GW_OWNER`.
  Capture: `out/focus/wt-topology-transcript.txt`, `out/focus/console-window-probe.json`.
- **Raw observation (verbatim):**

  ```
  window A: {"hwnd":"0x120998","pid":14008,...}
  window B: {"hwnd":"0x50594","pid":14008,...}
  two windows share PID: True
  multi window: {"hwnd":"0x30302","pid":14008,"title":"S3-MULTI-PANE"}
  sessions in that window:
    powershell.exe:<pid> <- WindowsTerminal.exe:14008   (tab A)
    powershell.exe:<pid> <- WindowsTerminal.exe:14008   (tab B)
    powershell.exe:<pid> <- WindowsTerminal.exe:14008   (split pane)
  console window probe: {"hwnd":"0x130590","pid":30428,"process":"powershell","class":"PseudoConsoleWindow"}
  console owner chain: 0x130590/PseudoConsoleWindow/powershell -> 0x2F086A/CASCADIA_HOSTING_WINDOW_CLASS/WindowsTerminal
  terminalEnv: WT_SESSION=f8f68138-34de-4290-b36e-e9d9ac6408af
  foreground samples: 0/9 matched their target window   (desktop contention; see limitations)
  ```

- **Conclusion:** (a) **Two separate WT windows shared one process (PID 14008)** —
  PID-only mapping is ambiguous for WT windows too. (b) Two tabs and a split pane
  live in a **single top-level HWND (0x30302)**; all three session processes resolve
  to the same `WindowsTerminal.exe` PID. The foreground window therefore cannot
  distinguish tabs/panes. (c) A session **can** discover its hosting WT window
  exactly: `GetConsoleWindow()` returns a `PseudoConsoleWindow` whose `GW_OWNER` is
  the WT top-level HWND (owner PID = WT PID), and `WT_SESSION` is also available.
  The same mechanism returns the real `ConsoleWindowClass` top-level window for a
  classic console (`GetForegroundWindow` PID = `cmd.exe`).
- **Tag:** [Verified] for (a), (b), (c) on WT 1.24 / build 26300. Foreground-sample
  contention noted; the topology facts do not depend on the samples.

## S3-F4 — Click-to-focus without delivering input

- **Date / build / tools:** 2026-10-20; 10.0.26300.0 (26H2); PowerShell 5.1; canary WinForms target; dedicated WT window.
- **Method:** `Invoke-ClickToFocus.ps1`. A foreground-granted "activator" canary
  (the model of a toast-activated handler) self-focuses, then calls plain
  `SetForegroundWindow(target)` on (1) a canary target and (2) a WT window. Both
  canaries log every key/mouse event. A control call from a background helper is
  included. Capture: `out/focus/click-to-focus-transcript.txt`.

  Exact command:
  `powershell -NoProfile -ExecutionPolicy Bypass -File focus/Invoke-ClickToFocus.ps1`

- **Raw observation (verbatim):**

  ```
  foreground before trigger: 0xA09F2 pid=25416 :: S3-ACTIVATOR
  canary target keyCount=0; activator keyCount=0
  activator focusAttempt={"method":"plain","targetHwnd":"0x1F098A","selfFocusRequested":true,
    "selfFocusAchieved":true,"foregroundBefore":"0xA09F2","foregroundBeforeIsSelf":true,
    "foregroundAfter":"0x2A07CA","targetIsForeground":false,"errors":[]}

  WT click target: {"hwnd":"0x2A08AE","pid":43368,"process":"WindowsTerminal","title":"S3-CLICKTARGET"}
  activator-2 focusAttempt={"method":"plain","targetHwnd":"0x2A08AE","selfFocusAchieved":false,
    "foregroundBefore":"0x4076A","foregroundBeforeIsSelf":false,
    "targetIsForeground":false,"errors":["SetForegroundWindow false"]}
  control: plain SetForegroundWindow from background helper: targetIsForeground=False
  ```

- **Conclusion:** No key or mouse event was delivered to either canary in any run
  (`keyCount=0`, `mouseCount=0`); the focus helper only changes z-order/foreground.
  A helper that actually owned the foreground (`selfFocusAchieved=true`) called
  `SetForegroundWindow` without error, but 400 ms later another application
  (Android emulator) was foreground, so the terminal/canary was **not** observably
  brought forward. The second case could not self-focus under contention and the
  call failed. **The exact toast-activation grant was not exercised**: the 0.10
  toast registration is not present on this branch (only the S3 README scaffold
  exists), and no toast was shown or clicked.
- **Tag:** [Verified] for "no input is delivered"; [Blocked] for "toast activation
  reliably brings the host forward".

---

## Q-06 — Is foreground-window detection reliable enough for F13?

**Answer: yes for the window/process identity, but only with an HWND source from
the session; PID-only mapping is not reliable.**

- `GetForegroundWindow()` + `GetWindowThreadProcessId` + class/title is cheap and
  deterministic. 15/15 stable samples across WT, VS Code, and classic console
  (S3-F2).
- Reliability fails at *session attribution*, not at detection:
  - Tabs/panes inside one WT window share one HWND and one PID (S3-F3). F13-R1 is
    window-scoped, so suppressing all sessions in that window is literally
    compliant, but an alert for a background pane is suppressed while the user
    looks at another pane.
  - Two WT windows can share one PID (S3-F3), and two VS Code windows do share one
    PID (S3-F2). Matching by process name/PID then produces **false positives**
    (alert suppressed because a *different* window of the same app is focused).
  - VS Code exposes no session→HWND mapping to extensions. A per-window identity
    cannot be obtained from the extension APIs tested here.
- Exact session→window mapping **is** available for terminal hosts:
  `GetConsoleWindow()` → `GW_OWNER` resolves to the hosting WT top-level HWND;
  for a classic console the console window itself is the top-level window
  (S3-F3). Compare `foreground HWND == session HWND` instead of comparing PIDs.

**Observed/expected false positives and negatives**

| Case | Effect | Evidence |
|---|---|---|
| Two panes/tabs in one WT window | False positive: both sessions count as focused | S3-F3 |
| Two WT windows on one PID | False positive if matching by PID | S3-F3 (`pid 14008`) |
| Two VS Code windows on one PID | False positive if matching by PID | S3-F2 (`pid 23044`) |
| Another app focused during a test | False negative in the sample (not a detector bug) | S3-F2 window-1 0/5 |
| IME/TextInputHost or a shell flyout foreground while typing in a terminal | Expected false negative (foreground HWND is not the host) | [Assumption] — not forced; `TextInputHost`/`Quick settings` windows were observed foreground during the session |
| Elevated terminal / UIPI | Not tested | [Blocked] |

## Q-07 — Can a toast activation bring the terminal/editor forward without input?

**Answer: feasible with window-management APIs and no input, but the toast grant
itself is unverified on this branch.**

- All routes tested used only `SetForegroundWindow`, `BringWindowToTop`,
  `ShowWindow`, `SetFocus`, `AttachThreadInput`, `SwitchToThisWindow`,
  `AllowSetForegroundWindow`, UIA `SetFocus`. No input API exists in the scripts.
- Background helpers are blocked by the foreground lock: `plain`, `attach`,
  `allow`, `switch`, UIA failed while another app held a fresh foreground (S3-F1).
- `attachfg` (attach to the *current foreground thread*, then
  `SetForegroundWindow`) succeeded 4/4 (2 focus + 2 restore) and is the reliable
  no-input fallback. It is a focus-stealing technique and should only be used in
  direct response to a user activation.
- A foreground-owned helper called `SetForegroundWindow` successfully (no error)
  but the observed foreground 400 ms later was another app; under a live desktop
  the outcome is not stable enough to claim a reliable "bring forward".
- **Not verified:** that clicking a real toast grants the handler foreground
  rights and that the subsequent `SetForegroundWindow(host)` is honored. This
  needs Task 0.10's registered toast identity, which does not exist on this
  branch. No toast was shown or clicked, so no toast activation result is claimed.

## Proposed F13 status

**Supported with a per-host capability gate; not a blanket "supported".**

- Windows Terminal and classic console: **supported**. Resolve the session's own
  top-level HWND via `GetConsoleWindow()` → `GW_OWNER` (WT) or
  `GetConsoleWindow()` (classic console), then compare it with
  `GetForegroundWindow()`. Window-level suppression is exact; pane/tab granularity
  is not available and must be documented.
- VS Code: **documented unsupported** for F13 window identity under F13-R2. The
  extension has no HWND source and PID-only matching is ambiguous when more than
  one VS Code window is open (measured: two windows, one PID). `doctor` must
  report focus awareness as unsupported for VS Code, and alerts must not be
  suppressed there.
- Do **not** approximate with process-name matching. That produces the measured
  false positives above and violates F13-R2.

**F6-R11 (click-to-focus, P2):** keep gated. The no-input property is verified and
`attachfg` is a working fallback, but the toast-activation path must be proven
after 0.10 before this is called feasible end-to-end.

## Limitations

- Single machine/build: Windows 11 26H2 build 26300, PowerShell 5.1, WT 1.24.
  No second Windows build was available.
- The desktop was in active use: Quick Settings, Edge, and an Android emulator took
  the foreground during runs. Two focus samples (VS Code window 1, WT topology)
  were lost to that contention; they are recorded as failures, not retried until
  they looked better.
- VS Code's integrated terminal was not exercised: opening one requires UI input,
  which this spike forbids. The VS Code conclusions are about top-level windows and
  the extension API surface, not about a live integrated terminal.
- No elevated host, no UIPI test, no multi-monitor/virtual-desktop test, no
  full-screen or minimized-host test, no IME-forced test.
- `attachfg` and `GetConsoleWindow`→`GW_OWNER` are implementation details of the
  current Windows/WT builds; they need a regression check before production use.
- A global low-level keyboard hook was not used to prove "zero input"; the proof is
  (a) absence of input APIs in the scripts and (b) zero key/mouse events logged by
  the focused canaries. A user keystroke occurring during a run would be logged by
  the canary (one such `Escape` was observed in an earlier run and is attributed to
  the user, not to the helper).

## Follow-ups

1. Re-run `Invoke-ClickToFocus.ps1` after Task 0.10 with a real toast activation
   handler and record whether the handler receives the foreground grant.
2. Add a VS Code window-identity source or keep F13 disabled there; do not fall
   back to PID matching.
3. Validate `GetConsoleWindow()`→`GW_OWNER` on the oldest supported WT version.
4. Add `focus` capability reporting to `doctor` (supported / unsupported per host).
