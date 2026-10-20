# S3 toast shard — per-user identity, escaping, suppression, RF-S3

> Private shard for Task 0.10. Does not modify `docs/spikes/s3-results.md`.
> Raw captures: `spikes/s3-windows-delivery/out/` (gitignored).
> Throwaway prototype: `spikes/s3-windows-delivery/toast/`.

- Date: 2026-10-20
- Host: Windows 11 Home Single Language 26H2, build **10.0.26300.9711**
- PowerShell 5.1.26100.9711 (Desktop), Node v24.20.0 (not used by this route)
- User: `LAPTOP-48SUV1B9\sanjai`, **not administrator**, interactive session 8
- Desktop: 2560×1600 physical; screenshots require `SetProcessDPIAware()` or the
  toast area is clipped (first captures were 1536×960 and missed it).
- Environment note: the desktop is shared with other concurrent spike sessions;
  screenshots contain their windows. Only `AgentAttention.S3Spike*` toasts were
  exercised here. No other session's controls were touched.

## S3-T01 — pre-state and registration surface

- Method: `snapshot.ps1` then `register.ps1` (cwd `spikes/s3-windows-delivery`).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\snapshot.ps1 -OutPath .\out\snapshot-pre.json
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\register.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\snapshot.ps1 -OutPath .\out\snapshot-post-register.json
```

- Raw observation (`snapshot-pre.json`): `RegistryKeyExists=false`,
  `ShortcutExists=false`, `AppSettingsKeyExists=false`,
  `GlobalToastEnabled=null`, `FocusSessionActive=false`.
- Raw observation (`register-result.txt`):

```json
{
  "Aumid": "AgentAttention.S3Spike",
  "RegistryKey": "HKCU:\\Software\\Classes\\AppUserModelId\\AgentAttention.S3Spike",
  "RegistryValues": [ "DisplayName", "IconUri" ],
  "ShortcutPath": "C:\\Users\\sanja\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Agent Attention S3 Spike.lnk",
  "ShortcutAumid": "AgentAttention.S3Spike"
}
```

- Created (all per-user, **no admin**):
  - `HKCU\Software\Classes\AppUserModelId\AgentAttention.S3Spike`
    - `DisplayName` = `Agent Attention S3 Spike` (REG_SZ)
    - `IconUri` = `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe` (REG_SZ)
  - `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Agent Attention S3 Spike.lnk`
    - target `C:\Windows\System32\cmd.exe /c exit`, icon set, and
      `System.AppUserModel.ID` = `AgentAttention.S3Spike` set through
      `IPropertyStore` (`PKEY_AppUserModel_ID`, fmtid
      `9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3`, pid 5).
  - First toast caused the OS to create
    `HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\AgentAttention.S3Spike`
    with `PeriodicNotificationCount` (REG_DWORD) and
    `LastNotificationAddedTime` (REG_QWORD). Not created by `register.ps1`.
- Nothing under `HKLM`; no package/MSIX identity; no admin prompt.
- Tag: **[Verified]**

## S3-T02 — templated toast with a hostile project name

- Method (payload on stdin; no event text on any command line):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\send-toast.ps1 `
  -ResultPath .\out\toast-banner.json -ScreenshotPath .\out\toast-banner.png -SettleMs 1000 `
  < out\payload-baseline.json
```

Payload project/body (verbatim, control characters escaped):

```text
<b>Evil</b> & "quoted" '; rm -rf ~ # $(calc) `whoami` %TEMP% [U+202E]gnp.exe
```

- Raw XML built through the WinRT DOM (`toast-banner.json`):

```xml
<toast><visual><binding template="ToastGeneric">
<text>Agent needs input</text>
<text>Project: &lt;b&gt;Evil&lt;/b&gt; &amp; "quoted" '; rm -rf ~ # $(calc) `whoami` %TEMP% [U+202E]gnp.exe</text>
</binding></visual><audio silent="true"/></toast>
```

- Raw API: `Submitted=true`, `NotifierSetting=""` (empty before first delivery),
  `HistoryCount=1`, `SubmitMs` not yet instrumented on this run.
- Visual evidence `out/toast-banner.png`: the banner shows app name
  `Agent Attention S3 Spike`, title `Agent needs input`, and this body text:

```text
Project: <b>Evil</b> & "quoted" '; rm -rf ~ # $(calc) `whoami` %TEMP% exe.png
```

  Markup renders as **literal text**; nothing executed. The scrambled `.exe`
  fragment is the retained U+202E override.
- Visual evidence `out/toast-dpi.png`: the same card in Notification Center with
  app name from `DisplayName` and the literal `<b>Evil</b> & "quoted"` body.
- Tag: **[Verified]**

## S3-T03 — control and bidi characters

- Method: same sender with `\u0001` in the project/body
  (`out/payload-controlchar.json`).
- Raw observation (`out/toast-controlchar.json`):

```json
{
  "Submitted": false,
  "Error": "Exception calling \"GetXml\" with \"0\" argument(s): \"Exception from HRESULT: 0xC00CE508\"",
  "Xml": null
}
```

- Conclusion: a C0 control character makes `XmlDocument.GetXml()` throw
  `0xC00CE508` before submission. Sanitization (§17.3) must strip C0 controls
  **before** the XML layer. U+202E is accepted by the XML layer and visibly
  reorders the rendered name (banner showed `%TEMP% exe.png`), so the bidi
  override must also be stripped before presentation. `0x0D/0x0A/0x09` are the
  only XML-legal C0 characters; treat everything else as invalid.
- Tag: **[Verified]** for both observations.

## S3-T04 — per-app notifications disabled

- Method: write the per-app switch, snapshot, send, then attempt restore.

```powershell
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\AgentAttention.S3Spike' -Name Enabled -Value 0 -Type DWord
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\send-toast.ps1 -ResultPath .\out\toast-app-disabled.json -ScreenshotPath .\out\toast-app-disabled.png -SettleMs 1000 < out\payload-baseline.json
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\AgentAttention.S3Spike' -Name Enabled -Value 1 -Type DWord
```

| Observation | Disabled (`Enabled=0`) | Restored (`Enabled=1`, then removed) |
|---|---|---|
| `Show()` | returned, `Submitted=true` | returned, `Submitted=true` |
| `ToastNotifier.Setting` | `"Enabled"` (wrong) | `"DisabledForApplication"` (stuck) |
| `History.GetHistory()` | **0** (prior 5 entries cleared) | 0 |
| Banner (`toast-app-disabled.png`) | **none** | **none** |

- Conclusion: delivery is suppressed immediately, but the API still reports
  success and initially reports `Setting=Enabled`; afterwards it reports
  `DisabledForApplication` even after the registry value is restored/removed.
  The shell caches the disabled state; restoring it needs the Settings UI (or a
  fresh AUMID). A second AUMID (`AgentAttention.S3Spike.Alt`) was registered to
  continue testing; it delivered normally (banner `out/toast-alt-baseline.png`).
- Tag: **[Verified]** for the table.
- Diagnostic detail: `Enabled=1` / deleting the value did not clear the cached
  disable within 6 s; `Setting` stayed `DisabledForApplication` and history 0.

## S3-T05 — global "Notifications" master toggle via registry

- Method: `global-state.ps1` saved the previous state (value absent = default
  enabled), set `NOC_GLOBAL_SETTING_TOASTS_ENABLED=0`, sent a toast, restored.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\global-state.ps1 -Action read
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\global-state.ps1 -Action disable -StatePath .\out\global-state.json
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\send-toast.ps1 -ResultPath .\out\toast-global-disabled.json -ScreenshotPath .\out\toast-global-disabled.png -SettleMs 900 < out\payload-alt.json
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\global-state.ps1 -Action restore -StatePath .\out\global-state.json
```

- Raw: `Action=disable Previous=null Now=0`; toast result `Submitted=true`,
  `NotifierSetting="Enabled"`, `HistoryCount=1`; banner visible in
  `out/toast-global-disabled.png`; `Action=restore ExistsNow=false`.
- Conclusion: writing the registry value alone does **not** suppress delivery on
  this build, so it is not a valid way to *simulate* the Settings toggle.
  Whether the value mirrors the real UI toggle for `doctor` display is
  unmeasured; treat as a hint, not authoritative.
- Tag: **[Rejected]** (registry-write simulation), with `[Assumption]` that the
  value is still useful as a read-only doctor hint when present.

## S3-T06 — Focus Assist / Do Not Disturb / quiet hours

- Detectable API: `Windows.UI.Shell.FocusSessionManager` (WinRT).
  - In PowerShell 5.1 the properties are `IsFocusActive` and `IsSupported`
    (not `IsFocusSessionActive`); both via reflection.
  - Raw (`snapshot-pre.json`): `FocusSessionManagerAvailable=true`,
    `FocusSessionActive=false`.
- Toggle attempt: `Win+A` sent via `keybd_event`; the Quick Settings surface did
  not open reliably under the concurrent desktop activity, and there is no
  supported setter on `FocusSessionManager`. No DND-on state was produced.
- Quiet hours: this build has no separate `HKCU\...\QuietHours` key; DND is
  backed by CloudStore keys
  `...\default$windows.data.donotdisturb.quiethoursprofile$quiethoursprofilelist`,
  `...quietmoment$quietmomentlist`, and
  `...default$windows.data.shell.focusactivesessions`. Quiet hours is the same
  DND/Focus feature in 26H2.
- Conclusion: `doctor` can read the DND state (`IsFocusActive`) without admin;
  toggling it requires the user/UI, and DND-on toast behavior was **not**
  measured.
- Tag: **[Verified]** for detection and the registry topology;
  **[Blocked]** for enabling DND and measuring suppression.

## S3-T07 — invoking terminal closed (RF-S3)

- Method: `launcher.vbs` starts `send-toast.ps1` through
  `cmd /c ... < payload` with window style 0, then exits immediately. Payload is
  a file on stdin; the command line contains only fixed paths.

```powershell
cscript //nologo toast\launcher.vbs `
  "C:\...\out\payload-rfs3.json" `
  "C:\...\out\result-rfs3.json" `
  "C:\...\toast\send-toast.ps1"
```

- Raw: launcher exit 0 immediately; `result-rfs3.json` appeared **4 s later**;
  `Submitted=true`, `NotifierSetting="Enabled"`, `HistoryCount=5` (incremented),
  `Pid=30384`, `ParentPid=6220` (cmd.exe), `ConsoleWindow=657598` (the child's
  own hidden console, not the invoking terminal). PID 6220 was gone afterwards.
  Direct (non-launcher) runs report `ConsoleWindow=0`.
- Conclusion: delivery does not depend on the invoking terminal or a visible
  console; the child outlived the launcher and recorded its own result.
  Registration and the notification platform still require the interactive
  desktop session (session 8); no service/session-0 claim is made.
- Tag: **[Verified]**

## S3-T08 — unregistered AUMID (does registration gate delivery?)

- Method: send with `AgentAttention.S3Spike.Never`, which has no registry key,
  no shortcut, and no app-settings key (`out/payload-unregistered.json`).

| Run | `Show()` | `Setting` | History | Banner |
|---|---|---|---|---|
| 1 (500 ms) | `Submitted=true` | `""` | 1 | not captured |
| 2 (900 ms) | `Submitted=true` | `"Enabled"` | 2 | none (panel covered corner) |
| 3 (600 ms) | `Submitted=true` | `"Enabled"` | 4 | none |

- No `HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\AgentAttention.S3Spike.Never`
  key was created. `SubmitMs=9`.
- Conclusion: on build 26300, `ToastNotificationManager.CreateToastNotifier()` +
  `Show()` **succeed without any registration**, and the toast enters the
  per-AUMID history, but no banner was presented in two unobstructed captures.
  Registration is therefore required for the visible, correctly-branded toast
  (F6-R9), and `Show()` returning success is not proof of delivery. The exact
  cause of the missing banner is inferred from observation, not documented.
- Tag: **[Verified]** for API/history/absence of banner; `[Assumption]` that
  missing registration is the cause.

## S3-T09 — latency (3 warm samples, `SettleMs=0`, no screenshot)

| Sample | Process wall | In-script duration | `Show()` |
|---|---|---|---|
| 1 | 1367 ms | 276 ms | 12 ms |
| 2 | 1227 ms | 244 ms | 10 ms |
| 3 | 1197 ms | 259 ms | 8 ms |

- Conclusion: the WinRT submit itself is ~10 ms; PowerShell 5.1 startup and
  WinRT activation dominate (~1.2–1.4 s wall). This is host-side alert latency,
  not shim latency; a persistent host or native helper avoids most of it.
- Tag: **[Verified]**

## S3-T10 — second Windows build

- Checked: only this machine/build is accessible; Windows 11 Home cannot run
  Windows Sandbox, and no second build or VM is available to the non-admin
  session.
- Tag: **[Blocked]** — no second-build evidence. Do not claim cross-build
  behavior.

## S3-T11 — cleanup

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\unregister.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\unregister.ps1 `
  -Aumid "AgentAttention.S3Spike.Alt" -ShortcutName "Agent Attention S3 Spike Alt"
powershell -NoProfile -ExecutionPolicy Bypass -File .\toast\clear-history.ps1
```

- Raw (`out/cleanup.txt`):

```json
{"RegistryKeyRemoved":"HKCU:\\Software\\Classes\\AppUserModelId\\AgentAttention.S3Spike","RegistryKeyExistsAfter":false,"ShortcutRemoved":"...\\Agent Attention S3 Spike.lnk","ShortcutExistsAfter":false,"AppSettingsKeyRemoved":"HKCU:\\...\\Notifications\\Settings\\AgentAttention.S3Spike","AppSettingsKeyExistsAfter":false}
{"RegistryKeyRemoved":"HKCU:\\Software\\Classes\\AppUserModelId\\AgentAttention.S3Spike.Alt","RegistryKeyExistsAfter":false,"ShortcutRemoved":"...\\Agent Attention S3 Spike Alt.lnk","ShortcutExistsAfter":false,"AppSettingsKeyRemoved":"HKCU:\\...\\Notifications\\Settings\\AgentAttention.S3Spike.Alt","AppSettingsKeyExistsAfter":false}
```

- Verified with `reg query` (both keys and both app-settings keys `ABSENT`) and
  `snapshot-cleanup.json` (`RegistryKeyExists=false`, `ShortcutExists=false`,
  `AppSettingsKeyExists=false`). Global toggle restored to absent/default.
- Toast history cleared for all three AUMIDs (`clear-history.ps1`):
  `CLEARED AgentAttention.S3Spike HISTORY_AFTER=0` (same for `.Alt` and
  `.Never`). `unregister.ps1` does not clear history; `uninstall` should call
  the equivalent.
- No registry keys, Start Menu shortcuts, or per-user files created by the
  spike remain; raw captures stay under `spikes/**/out/` (gitignored).
- Caveat [Verified]: after key/shortcut removal the notification platform still
  resolved the AUMID in the same shell session (`Setting=DisabledForApplication`
  from its cache). `uninstall` should verify durable artifacts are gone and may
  need a shell-restart note; the cache is not a registry key created by install.
- Tag: **[Verified]**

## What the toast API does and does not report

| Signal | Meaning | Reliability here |
|---|---|---|
| `Show()` return | accepted for submission; returns void/throws only on bad XML/notifier | **not** proof of display (unregistered and app-disabled cases both succeeded) |
| `ToastNotifier.Setting` | `Enabled` / `DisabledForApplication` / `DisabledForUser` / group policy | stale: `Enabled` while app-disabled; stuck `DisabledForApplication` after restore; empty before first delivery |
| `History.GetHistory(aumid)` | notifications retained for the AUMID | weak: increments for unregistered AUMIDs that never banner; cleared by app-disable |
| `ToastNotification.Activated`/`Dismissed` | user action events | exist but require a live process and only cover interaction, not "seen" |
| `FocusSessionManager.IsFocusActive` | DND/Focus Assist state | readable without admin; toggle not programmatic |
| Per-app `Enabled` registry value | user's app notification switch | matches suppression behavior; best doctor signal |

**Conclusion for F6-R10:** record only *submitted*; there is no API evidence of
*seen*. `doctor` must not rely on `Show()` or `Setting`; check registration
artifacts, the per-app `Enabled` value, and `IsFocusActive`, and report
`unknown` when unreadable.

## Proposed Q-05 toast route (for Task 0.12; proposal, not a measured decision)

1. **Registration (install, no admin):** create
   `HKCU\Software\Classes\AppUserModelId\<AUMID>` with `DisplayName` + `IconUri`,
   and a Start Menu `.lnk` carrying `System.AppUserModel.ID`. Create the
   per-app settings key only if the OS has not; remove both on `uninstall`.
   Verify key + shortcut in `doctor`.
2. **Submission:** WinRT `ToastNotificationManager` with a
   `ToastGeneric` binding. Build the XML with the DOM (or one centralized,
   tested escaper); never interpolate event text into XML, shell, or command
   lines. Pass event text as JSON on **stdin** to a fixed script/helper.
3. **Input hygiene before XML:** strip C0 controls (except XML-legal
   tab/LF/CR), bidi overrides/isolates (U+202A–U+202E, U+2066–U+2069), cap at
   64 chars per §17.3; otherwise `GetXml()` throws `0xC00CE508`.
4. **Delivery record:** `submitted` only after a successful `Show()` **and**
   registration present; never `seen`. Optionally record the pre/post history
   count as a weak confirmation.
5. **Latency:** ~10 ms submit; PowerShell startup ~1.2–1.4 s. Prefer a
   persistent host/native helper for routine delivery and keep the fixed
   PowerShell script as the proven fallback (no admin, no cloud).
6. **Suppression:** read per-app `Enabled`, `FocusSessionManager.IsFocusActive`,
   and registration presence; do not treat the global registry toggle as
   authoritative. Toggling app notifications must go through the Settings UI.
7. **Uninstall:** delete the AUMID key, shortcut, and app-settings key; clear
   per-AUMID toast history; record that the shell may cache the identity until
   restart.

## Files

- Prototype: `spikes/s3-windows-delivery/toast/{register,unregister,send-toast,snapshot,global-state,clear-history,window-probe}.ps1`,
  `launcher.vbs`, `README.md`.
- Raw captures (gitignored): `spikes/s3-windows-delivery/out/` — notably
  `toast-banner.png`, `toast-dpi.png`, `toast-alt-baseline.png`,
  `toast-app-disabled.png`, `toast-global-disabled.png`,
  `toast-unregistered*.png`, `result-rfs3.json`, `cleanup.txt`.
