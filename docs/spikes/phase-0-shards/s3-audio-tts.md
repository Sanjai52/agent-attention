# Phase 0 shard — S3 audio and TTS (Tasks 0.8, 0.9)

Private evidence shard. The consolidated `docs/spikes/s3-results.md` is owned by
the Task 0.12 selection pass and is intentionally not modified here.

- Date: 2026-10-20
- Windows: `Microsoft Windows NT 10.0.26300.0` (build 26300.9711)
- PowerShell: 5.1.26100.9711
- Node: v24.20.0
- Working directory for every command: `spikes/s3-windows-delivery`
- Generated artifacts: `spikes/s3-windows-delivery/out/` (gitignored)
- Scripts: `spikes/s3-windows-delivery/audio/`, `.../tts/`

## Checklist coverage

| Task      | Evidence                                                                                                                                      | Status                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 0.8 audio | Two routes; cold/warm spawn→play; missing/corrupt file; AV observation; terminal-closed; command-line injection surface                       | Complete except no-device (`Blocked`, no admin) |
| 0.9 TTS   | stdin-only text; voice enumeration; rate/volume; hostile string; missing voice; time-to-first-audio; cancellation; terminal-closed; cold/warm | Complete except zero-voice system (`Blocked`)   |

---

## S3-A01 — Audio route A: fixed PowerShell `System.Media.SoundPlayer`, cold vs warm and first vs steady state

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0 (26300.9711); PowerShell 5.1.26100.9711; Node v24.20.0; interactive shell; 600 ms 44.1 kHz mono PCM WAV.
- **Method (exact command or script path):**
  ```
  node audio/gen-tone.mjs out/tone-600ms.wav 0.6 660
  node audio/time-first-play.mjs "out/tone-600ms.wav" 6
  powershell -NoProfile -ExecutionPolicy Bypass -File audio/play-soundplayer.ps1 -Path "out/tone-600ms.wav" -Repeat 3
  ```
  `play-soundplayer.ps1` is fixed: it takes only `-Path` (app asset path), `-Repeat`, `-SpacingMs`; it calls `Load()` then `Play()` and prints `FIRST_PLAY_MS=` immediately after the first `Play()`.
- **Raw observation (verbatim excerpt):** `out/audio-timing.json`
  ```
  run0 first=488.3  steady=[0.63,0.51]
  run1 first=680.83 steady=[2.55,0.5]
  run2 first=487.32 steady=[0.71,0.53]
  run3 first=432.12 steady=[0.48,0.68]
  run4 first=551.12 steady=[0.54,0.74]
  run5 first=391.49 steady=[0.46,0.62]
  ```
  Spawn→`Play()` accepted: n=6, min 391.49 ms, median 488.30 ms, max 680.83 ms.
  In-process `Play()` call after the first: n=12, min 0.46 ms, median 0.62 ms, max 2.55 ms.
  Single run (`-Repeat 3`): `{"loadMs":18.81,"playCallMs":18.85,"calls":[{"index":1,"playCallMs":18.85,"sinceStartMs":185.27},{"index":2,"playCallMs":0.77},{"index":3,"playCallMs":2.09}]}`
- **Conclusion:** Route A works unpackaged with no third-party dependency. The cost is one PowerShell process per sound: ~0.4–0.7 s from spawn to playback queued, and this is dominated by PowerShell startup, not by `SoundPlayer` (`Load` 10–48 ms). Steady-state in-process calls are sub-3 ms. Audible onset is later than `Play()` returning by the device buffer, which was not measured ([Assumption] ~10–50 ms).
- **Tag:** [Verified]

## S3-A02 — Audio route B: Node-native `winmm` MCI via koffi, cold vs warm and first vs steady state

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; Node v24.20.0; koffi 3.3.3 (prebuilt win32-x64, installed with `npm install --no-save --no-package-lock koffi@3.3.3`, which places it in the repo root `node_modules`; gitignored).
- **Method (exact command or script path):**
  ```
  node audio/play-mci.mjs out/tone-600ms.wav 3
  node audio/time-first-play.mjs "out/tone-600ms.wav" 6
  ```
  `play-mci.mjs` calls `mciSendStringW("open \"<path>\" type waveaudio alias spike")`, then `play spike`; no PowerShell and no shell. It prints `FIRST_PLAY_MS=` after `play` returns.
- **Raw observation (verbatim excerpt):** `out/audio-timing.json`
  ```
  run0 first=266.56 steady=[74.54,385.05]
  run1 first=320.16 steady=[89.8,103.67]
  run2 first=231.48 steady=[94.45,77.83]
  run3 first=277.82 steady=[77.29,73.14]
  run4 first=334.06 steady=[85.43,95.14]
  run5 first=210.39 steady=[66.98,64.59]
  ```
  Spawn→`play` accepted: n=6, min 210.39 ms, median 277.82 ms, max 334.06 ms.
  `open` 45.03–273.64 ms; first `play` 88.16–265.36 ms; subsequent `play` n=12, median 85.43 ms, min 64.59 ms, max 385.05 ms.
  Raw single run: `{"route":"mci-koffi","openMs":82.69,"calls":[{"index":1,"playCallMs":252.54},{"index":2,"playCallMs":114.43},{"index":3,"playCallMs":157.45}]}`
- **Conclusion:** Route B is viable unpackaged and is ~1.75× faster than route A from process spawn to playback accepted (median 278 ms vs 488 ms), with no shell and no console. It is not free: `mciSendStringW("play")` is effectively synchronous per start, costing a median ~85 ms per utterance even in a warm process, and it adds one native dependency (koffi) whose prebuilt binary must ship for the target ABI. In a resident Notification Host the module is loaded once, so the relevant warm cost is `open`+`play` (~0.1–0.3 s), not the Node startup included above.
- **Tag:** [Verified]

## S3-A03 — Audio failure paths: missing file and corrupt file

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; Node v24.20.0; PowerShell 5.1.26100.9711.
- **Method (exact command or script path):**
  ```
  node audio/measure-audio.mjs "out/tone-600ms.wav" 5
  ```
  The harness runs both routes against `out/tone-600ms.wav.missing.wav` and `out/corrupt.wav` (text bytes with a `.wav` name).
- **Raw observation (verbatim excerpt):** `out/audio-measurements.json`
  ```
  missing (soundplayer): status=0, loadMs=null,
    error="System.Management.Automation.MethodInvocationException: Exception calling \"Load\" with \"0\" argument(s): \"Please be sure a sound file exists at the specified location.\""
  missing (mci): error="Error: MCI 304: The filename is invalid. ..."
  corrupt (soundplayer): error="... The file located at out/corrupt.wav is not a valid wave file."
  corrupt (mci): error="Error: MCI 296: The specified file cannot be played on the specified MCI device. ..."
  ```
  Wall time for the failure path: SoundPlayer 698.72 ms (missing) / 789.04 ms (corrupt); MCI 236.06 ms / 243.58 ms.
- **Conclusion:** Both routes surface a typed, catchable failure instead of hanging or crashing the parent. The scripts report the error as JSON (route A) or a non-zero MCI code with message (route B). A provider can fall back to the alternate route or a silent-only notification.
- **Tag:** [Verified]

## S3-A04 — Audio with no output device

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711.
- **Method (exact command or script path):**
  ```
  powershell -NoProfile -Command "$id=[Security.Principal.WindowsIdentity]::GetCurrent(); (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
  powershell -NoProfile -Command "Get-CimInstance Win32_SoundDevice | Select-Object Name,Status"
  ```
- **Raw observation (verbatim excerpt):**
  ```
  IsAdmin=False
  Name                                                  Status
  Realtek High Definition Audio                         OK
  Intelr Smart Sound Technology for Digital Microphones OK
  NVIDIA Virtual Audio Device (Wave Extensible) (WDM)   OK
  Intelr Smart Sound Technology for Bluetoothr Audio    OK
  Intelr Smart Sound Technology for USB Audio           OK
  ```
- **Conclusion:** This host has five healthy endpoints and the session is not elevated. Removing/disabling the endpoint (`Disable-PnpDevice`) requires administrator rights and was not performed, so the true no-device behavior of either route is unmeasured. The failure-reporting path is at least exercised by S3-A03; `SetOutputToNull` covers the analogous TTS path (S3-T06).
- **Tag:** [Blocked]

## S3-A05 — Audio AV/EDR observation (Windows Defender)

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; Defender service enabled with real-time, behavior, IOAV, and on-access protection.
- **Method (exact command or script path):**
  ```
  powershell -NoProfile -Command "Start-MpScan -ScanType CustomScan -ScanPath '<repo>\spikes\s3-windows-delivery\audio'; @(Get-MpThreatDetection).Count"
  powershell -NoProfile -Command "Get-MpComputerStatus | Select-Object ...; Get-WinEvent -LogName 'Microsoft-Windows-Windows Defender/Operational' -MaxEvents 10"
  ```
- **Raw observation (verbatim excerpt):** `out/defender-scan.log`
  ```
  scan=completed
  0
  ```
  `Get-MpComputerStatus`: `AMServiceEnabled=True`, `RealTimeProtectionEnabled=True`, `AntivirusEnabled=True`, `BehaviorMonitorEnabled=True`, `IoavProtectionEnabled=True`, `OnAccessProtectionEnabled=True`. Recent Defender events were Information-level (IDs 2010, 1151, 1150, 5007, 2000); no detection events.
- **Conclusion:** On this host, with Defender as the only EDR, neither the PowerShell invocation, the koffi prebuilt binary, nor the generated WAV was flagged (custom scan completed, 0 detections, no detection events). This is evidence for Defender only; third-party EDR (CrowdStrike, SentinelOne, etc.) was not available and remains [Assumption] until tested.
- **Tag:** [Verified] (Defender); [Assumption] (other EDR products)

## S3-A06 — Audio with the invoking terminal closed (RF-S3)

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711; Node v24.20.0.
- **Method (exact command or script path):**
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File audio/trigger-rfs3.ps1 -Route soundplayer
  powershell -NoProfile -ExecutionPolicy Bypass -File audio/trigger-rfs3.ps1 -Route mci
  ```
  The trigger calls WMI `Win32_Process.Create` with a fixed command line, so the child's parent is `WmiPrvSE.exe`, not the shell; the trigger returns immediately and the result is read from `out/rfs3-*.json` in a later shell.
- **Raw observation (verbatim excerpt):**
  `out/rfs3-soundplayer.json`:
  ```
  "parentPid": 25816, "parentName": "WmiPrvSE.exe", "consoleWindowHandle": 723410,
  "output": "{\"route\":\"soundplayer\",\"loadMs\":46.38,\"playCallMs\":26.17,\"calls\":[{\"index\":1,\"playCallMs\":26.17,\"sinceStartMs\":103.81}],\"error\":null,\"totalMs\":829.86}"
  ```
  `out/rfs3-mci.json`:
  ```
  "parentName": "WmiPrvSE.exe", "output": "FIRST_PLAY_MS=485.77\r\n{\"route\":\"mci-koffi\",\"openMs\":45.03,\"calls\":[{\"index\":1,\"playCallMs\":440.69,\"sinceStartMs\":485.76}],\"error\":null}"
  ```
  An earlier detached-spawn attempt (`audio/run-detached.mjs`) produced empty logs because this harness terminates the process tree when the invoking command exits; that approach is kept as a [Rejected] RF-S3 method and replaced by the WMI-owned child above.
- **Conclusion:** Both routes play when the invoking terminal no longer exists. Route A retained its ~104 ms script-start→play cost; route B's 486 ms here includes the extra PowerShell wrapper used to launch Node, not the production in-process path (S3-A02). `consoleWindowHandle` is non-zero because PowerShell creates a hidden console for itself; it is not the invoking terminal, and `windowsHide` prevents a visible window.
- **Tag:** [Verified]

## S3-A07 — Audio command-line injection surface

- **Date / Windows build / tool versions:** 2026-10-20; PowerShell 5.1.26100.9711; Node v24.20.0.
- **Method (exact command or script path):**
  ```
  grep -n "Invoke-Expression\|iex \|Invoke-Command\|Start-Process" audio/*.ps1
  # inspect parameter blocks of audio/play-soundplayer.ps1 and audio/play-mci.mjs
  ```
- **Raw observation (verbatim excerpt):**
  ```
  audio/play-soundplayer.ps1:27:  Add-Type -AssemblyName System
  (no Invoke-Expression, Invoke-Command, iex, or Start-Process)
  param([Parameter(Mandatory = $true)][string]$Path, [int]$Repeat = 1, [int]$SpacingMs = 650)
  ```
  Route B receives the WAV path as a Win32 API argument (`mciSendStringW`), never as shell text.
- **Conclusion:** No event-derived text reaches a command line: the fixed scripts accept only an app-controlled asset path plus numeric/switch options, and no shell string is built from input. Residual risk: `SoundPlayer.SoundLocation` accepts URLs and arbitrary local paths, so production MUST pin the path to a bundled asset under the install directory. Windows filenames cannot contain `"`, so the MCI quoting cannot be escaped by a filename.
- **Tag:** [Verified] (script surface); [Assumption] (production path pinning)

---

## S3-T01 — TTS voice enumeration

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711; `System.Speech` from .NET Framework.
- **Method (exact command or script path):**
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File tts/list-voices.ps1
  ```
- **Raw observation (verbatim excerpt):** `out/tts-voices.json`
  ```
  {"count":3,"voices":[
    {"name":"Microsoft David Desktop","culture":"en-US","gender":"Male","age":"Adult","enabled":true},
    {"name":"Microsoft Hazel Desktop","culture":"en-GB","gender":"Female","age":"Adult","enabled":true},
    {"name":"Microsoft Zira Desktop","culture":"en-US","gender":"Female","age":"Adult","enabled":true}]}
  ```
- **Conclusion:** Enumeration works and exposes name, culture, gender, age, and enabled state, which is enough to populate a voice picker and to omit a saved voice that has disappeared. Three Desktop voices are installed on this host.
- **Tag:** [Verified]

## S3-T02 — TTS cold vs warm time-to-first-audio

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711; Node v24.20.0; text `Agent needs your approval.` (26 chars).
- **Method (exact command or script path):**
  ```
  node tts/measure-tts.mjs
  ```
  `speak.ps1` creates `SpeechSynthesizer`, registers `SpeakProgress`/`SpeakCompleted`, calls `SpeakAsync`, and prints `FIRST_AUDIO_MS=` on the first `SpeakProgress` (word rendered to the device). The harness timestamps spawn→that line. `-Repeat 3` measures the warm in-process case.
- **Raw observation (verbatim excerpt):** `out/tts-measurements.json`
  ```
  run0 first=861.33 wall=2976.33 uttFirst=314.81
  run1 first=818.37 wall=2966.74 uttFirst=299.94
  run2 first=841.45 wall=2962.8  uttFirst=295.16
  run3 first=817.05 wall=2933.58 uttFirst=315.76
  run4 first=852.67 wall=2970.09 uttFirst=275.04
  warmInProcess: 326.88, 210.64, 199.32 (firstAudioMs per utterance)
  ```
  Spawn→first rendered word: n=5, min 817.05 ms, median 841.45 ms, max 861.33 ms.
  Inside the script (after PowerShell startup), first utterance: 275–316 ms; utterances 2–3 in the same synthesizer: 199–211 ms.
- **Conclusion:** Cold TTS costs ~0.82–0.86 s end-to-end, dominated by PowerShell startup plus SAPI/voice initialization; the synth itself reaches first audio in ~0.3 s, and ~0.2 s once warm. This is off the shim path (the shim cap applies to event dispatch), but a TTS provider that spawns per utterance will add ~0.8 s to every announcement. A resident host should keep a TTS worker (or reuse the synthesizer) to get the ~0.2 s warm figure.
- **Tag:** [Verified]

## S3-T03 — TTS rate and volume control

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711.
- **Method (exact command or script path):**
  ```
  node tts/measure-tts.mjs
  # internally: speak.ps1 -Rate -5 -Volume 20  vs  -Rate 5 -Volume 100
  ```
- **Raw observation (verbatim excerpt):**
  ```
  slowQuiet: firstAudioMs=389.17 completedMs=3911.9
  fastLoud:  firstAudioMs=254.66 completedMs=1416.59
  ```
  Same 26-character text; `Rate` is clamped to [-10, 10] and `Volume` to [0, 100] in the script.
- **Conclusion:** Both controls take effect: the slow/quiet utterance took 3.91 s versus 1.42 s for the fast/loud one, and both completed normally. Values outside the SAPI range are clamped rather than throwing.
- **Tag:** [Verified]

## S3-T04 — TTS hostile string on stdin: no execution, no text mangling

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711; Node v24.20.0.
- **Method (exact command or script path):**
  ```
  node tts/gen-hostile.mjs out
  node tts/measure-tts.mjs
  ```
  The 126-character UTF-8 fixture (no BOM, no trailing newline) contains:
  `"; rm -rf ~ #` / `"; Set-Content -Path canary-pwned.txt -Value PWNED; # $(Get-Process) `whoami`` / bidi overrides U+202E, U+202D, U+2066, U+2069, U+202B.
  The child runs with `USERPROFILE`/`HOME` pointing at `out/fakehome` and cwd in that directory, containing `sentinel.txt`.
- **Raw observation (verbatim excerpt):**
  ```
  chars=126
  stdinSha256="9c6a24d885d722db81d7b1c4b618685403627a0461b9afcca5d43a1eae6617a9"
  expectedSha256="9c6a24d885d722db81d7b1c4b618685403627a0461b9afcca5d43a1eae6617a9"
  canaryPwnedExists=false, sentinelExistsAfter=true
  firstAudioMs=367.52, completedMs=13083.55, error=null
  ```
  An earlier version read stdin with `[Console]::In.ReadToEnd()` and produced `chars=136` with SHA-256 `23c2ae01…` (mojibake) instead of 126/`9c6a24d8…`; that path was fixed by reading `[Console]::OpenStandardInput()` bytes and decoding UTF-8 explicitly.
- **Conclusion:** The hostile text is spoken as text: the received bytes hash-match the fixture exactly, no canary file was created, the sentinel survived, and the process exited 0. There is no path from stdin text to command execution. Two limits: (a) the utterance took ~13 s because SAPI voices punctuation and bidi characters, so PRD §17.3 stripping of control/bidi characters is still required before speech; (b) success is not audible verification that every character was pronounced as intended—only that it was rendered without error.
- **Tag:** [Verified]

## S3-T05 — TTS with a missing / uninstalled voice

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711.
- **Method (exact command or script path):**
  ```
  node tts/measure-tts.mjs
  # internally: speak.ps1 -Voice "Microsoft No Such Voice"
  ```
- **Raw observation (verbatim excerpt):**
  ```
  "utterances":[],"error":"System.Management.Automation.MethodInvocationException:
   Exception calling \"SelectVoice\" with \"1\" argument(s):
   \"Cannot set voice. No matching voice is installed or the voice was disabled.\""
  "totalMs":378.48
  ```
- **Conclusion:** A saved-but-removed voice fails fast (~0.38 s) with a specific diagnostic and synthesizes nothing, so the provider can catch it and fall back to the default voice or omit voice. A machine with **zero** voices installed could not be produced without uninstalling system components; that case remains unmeasured.
- **Tag:** [Verified] (missing selected voice); [Blocked] (zero-voice system)

## S3-T06 — TTS with no audio endpoint (`SetOutputToNull`)

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711.
- **Method (exact command or script path):**
  ```
  node tts/measure-tts.mjs
  # internally: speak.ps1 -NullOutput
  ```
- **Raw observation (verbatim excerpt):**
  ```
  "utterances":[{"index":1,"firstAudioMs":92.34,"completedMs":96.02,"cancelled":false,"completed":true}],"error":null
  ```
- **Conclusion:** Synthesis does not require a live endpoint; with output redirected to null it still completes and reports success in ~96 ms. This is a code-path proxy, not a disabled-device test: an actually disabled/removed endpoint was not reproducible without admin (see S3-A04).
- **Tag:** [Verified] (`SetOutputToNull` path); [Assumption] (disabled endpoint behavior)

## S3-T07 — TTS cancellation and queue cancellation

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711.
- **Method (exact command or script path):**
  ```
  node tts/measure-tts.mjs
  # internally: speak.ps1 -Mode cancel -CancelAfterMs 800
  #             speak.ps1 -Mode queue  -CancelAfterMs 800
  ```
  Long text: 12 repetitions of a sentence (732 chars). Cancel is requested 800 ms after the first `SpeakProgress`; the result waits for `SpeakCompleted`.
- **Raw observation (verbatim excerpt):**
  ```
  cancel:      firstAudioMs=294.65 completedMs=1176.82 cancelled=true completed=true
  queueCancel: firstAudioMs=313.84 completedMs=1208.33 cancelled=true completed=true
  ```
- **Conclusion:** `SpeakAsyncCancelAll()` stops both a single long utterance and a two-item queue; `SpeakCompleted.Cancelled` is true and completion arrives ~0.38 s after the cancel request (≈1.18 s after speech start vs a multi-second utterance). A queued announcement can therefore be stopped when the session resolves. Only the first completion event was consumed in queue mode; the test proves the queue was cancelled, not the per-item event count.
- **Tag:** [Verified]

## S3-T08 — TTS with the invoking terminal closed (RF-S3)

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; PowerShell 5.1.26100.9711; Node v24.20.0.
- **Method (exact command or script path):**
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File tts/trigger-rfs3.ps1 -Text short
  # later shell:
  Get-Content out/rfs3-tts-short.json
  powershell -NoProfile -ExecutionPolicy Bypass -File tts/trigger-rfs3.ps1 -Text hostile
  Get-Content out/rfs3-tts-hostile.json
  ```
  The trigger uses WMI `Win32_Process.Create` to run Node, which spawns the fixed `speak.ps1` and writes UTF-8 bytes to its stdin. The invoking shell is gone before the child finishes.
- **Raw observation (verbatim excerpt):**
  `out/rfs3-tts-short.json`:
  ```
  "pid": 18788, "ppid": 25816, "exitCode": 0,
  "stdout": "FIRST_AUDIO_MS=582.78\r\n{... \"chars\":26,\"stdinSha256\":\"eff13d03…\",\"utterances\":[{\"firstAudioMs\":364,\"completedMs\":2443.45,\"cancelled\":false,\"completed\":true}]}",
  "canaryPwnedExists": false, "sentinelExists": true
  ```
  `out/rfs3-tts-hostile.json`:
  ```
  "exitCode": 0, "bytesIn": 136,
  "stdout": "FIRST_AUDIO_MS=555.23\r\n{... \"chars\":126,\"stdinSha256\":\"9c6a24d8…\",\"completedMs\":13060.17 ...}",
  "canaryPwnedExists": false, "sentinelExists": true
  ```
  `ppid` 25816 resolves to `WmiPrvSE.exe`.
- **Conclusion:** TTS works with no terminal attached, including the hostile fixture; first audio ~0.56–0.58 s in this configuration and completion as expected. This removes the RF-S3 risk that the PowerShell route only works interactively.
- **Tag:** [Verified]

## S3-T09 — TTS AV/EDR observation (Windows Defender)

- **Date / Windows build / tool versions:** 2026-10-20; Windows 10.0.26300.0; Defender real-time/behavior/IOAV/on-access enabled.
- **Method (exact command or script path):**
  ```
  powershell -NoProfile -Command "Start-MpScan -ScanType CustomScan -ScanPath '<repo>\spikes\s3-windows-delivery\tts'; @(Get-MpThreatDetection).Count"
  ```
- **Raw observation (verbatim excerpt):** `out/defender-scan-tts.log`
  ```
  scan=completed
  0
  ```
- **Conclusion:** Defender did not flag the fixed TTS script or its invocation, and no detection events appeared. Third-party EDR remains [Assumption].
- **Tag:** [Verified] (Defender); [Assumption] (other EDR products)

---

## Proposed Q-05 answer — audio and TTS routes

**Audio (proposed):** use the **in-process Node `winmm` MCI route (koffi)** as the
primary sound provider, with the **fixed PowerShell `SoundPlayer` script** as the
fallback.

| Criterion (PRD §10)                   | MCI + koffi (route B)               | PowerShell SoundPlayer (route A)          |
| ------------------------------------- | ----------------------------------- | ----------------------------------------- |
| Works unpackaged, per-user, no admin  | Yes; prebuilt win32-x64 binary      | Yes; built into Windows                   |
| No string-interpolated shell          | Yes; Win32 API argument             | Yes; fixed script, `-Path` parameter only |
| Startup latency (spawn→play accepted) | median 278 ms                       | median 488 ms                             |
| Steady-state cost                     | ~85 ms per start                    | ~0.6 ms per queued start                  |
| AV/EDR                                | Defender clean (scan, 0 detections) | Defender clean (scan, 0 detections)       |
| Failure mode                          | typed MCI code + message            | catchable .NET exception                  |
| Extra dependency                      | native addon (koffi 3.3.3)          | none                                      |

Rationale: the Notification Host is long-lived and Node-based, so route B removes
a process spawn and a console from the hot path while keeping text out of any
shell; route A is the dependency-free fallback if the native module fails to load
on a target or is blocked by EDR. Both routes need the same production guard:
the WAV path is a pinned asset under the install directory, never event-derived
(`SoundPlayer.SoundLocation` otherwise accepts URLs/arbitrary paths).

**TTS (proposed):** keep the **fixed PowerShell `System.Speech` script with
UTF-8 text on stdin** as the primary TTS provider, run from a resident
worker/synthesizer rather than spawned per announcement. Requirements:

1. Read `[Console]::OpenStandardInput()` bytes and decode UTF-8; **never**
   `[Console]::In` (measured 126→136 character mojibake).
2. Never interpolate text into the script or command line (measured hostile
   stdin: SHA-256 match, no canary execution, sentinel intact).
3. Strip control and bidi characters per PRD §17.3 before speaking; the hostile
   fixture took ~13 s because SAPI voices punctuation and overrides.
4. Catch missing/disabled voices (`SelectVoice` throws) and fall back to the
   default voice or omit the voice segment.
5. Use `SpeakAsyncCancelAll()` to stop a stale announcement; measured cancel
   completion `Cancelled=true` ~0.4 s after the request.

Cold spawn is ~0.82–0.86 s to first audio; warm in-process is ~0.2 s. If the host
cannot keep a worker, the ~0.85 s per-announcement cost must be accepted or TTS
must be treated as best-effort beyond the 1000 ms dispatch budget.

**Residual work for Task 0.12:** confirm MCI + koffi on a second Windows build and
under a third-party EDR; measure true audible onset (loopback) if the latency
budget is tight; test a genuinely disabled audio endpoint and a zero-voice
machine in a disposable VM.

## Tag summary

| Record                         | Tag                                          |
| ------------------------------ | -------------------------------------------- |
| S3-A01 SoundPlayer timing      | [Verified]                                   |
| S3-A02 MCI/koffi timing        | [Verified]                                   |
| S3-A03 missing/corrupt file    | [Verified]                                   |
| S3-A04 no audio device         | [Blocked]                                    |
| S3-A05 AV/EDR (audio)          | [Verified] Defender / [Assumption] other EDR |
| S3-A06 audio terminal-closed   | [Verified]                                   |
| S3-A07 audio injection surface | [Verified] / [Assumption] path pinning       |
| S3-T01 voice enumeration       | [Verified]                                   |
| S3-T02 TTS cold/warm           | [Verified]                                   |
| S3-T03 rate/volume             | [Verified]                                   |
| S3-T04 hostile stdin           | [Verified]                                   |
| S3-T05 missing voice           | [Verified] / [Blocked] zero-voice            |
| S3-T06 null output             | [Verified] / [Assumption] disabled endpoint  |
| S3-T07 cancellation            | [Verified]                                   |
| S3-T08 TTS terminal-closed     | [Verified]                                   |
| S3-T09 AV/EDR (TTS)            | [Verified] Defender / [Assumption] other EDR |
