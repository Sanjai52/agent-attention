# S3 — Windows Delivery Results

Status: audio, TTS, toast, and focus probes complete (Task 0.12 selection
below). Toast delivery was observed; DND-on suppression and toast-activation
focus were blocked and are recorded as limits, not successes.

Scope: measured Windows behavior of audio, TTS, toast, and focus mechanisms,
including unpackaged registration, suppression, and focus restoration. Produces
the Q-05/Q-06/Q-07 answers and the F13 feasibility decision.

- Spike workspace: [`../../spikes/s3-windows-delivery/README.md`](../../spikes/s3-windows-delivery/README.md)
- Decisions: PRD §10, §23.1, §23.2
- Raw captures: `spikes/s3-windows-delivery/out/` (gitignored)

## Evidence record format

Every experiment uses this record, including failed prototypes:

```markdown
## <experiment id> — <question>
- Date / Windows build / tool versions:
- Method (exact command or script path):
- Raw observation (verbatim output excerpt):
- Conclusion:
- Tag: [Verified] | [Assumption] | [Rejected]
```

## Recording rules

- **ID:** `S3-01`, `S3-02`, … sequential in the order recorded; never renumber.
- **Date / versions:** `YYYY-MM-DD`; the Windows build reported by `winver` or
  `[System.Environment]::OSVersion.Version`; PowerShell, Node, and provider
  versions; whether the run was interactive or had the invoking terminal closed.
- **Method:** the exact command line or script path, with arguments and working
  directory, enough to rerun the experiment. A README link alone is not enough.
- **Raw observation:** a verbatim excerpt, not a paraphrase. Cite the capture
  path and line range. For latency, report the sample count and cold/warm state;
  for suppression, report what the API returned versus what the user saw.
  Redact tokens, usernames, and credentials.
- **Conclusion:** answer the question and state any limit on the conclusion.
- **Tag:** exactly one of:
  - `[Verified]` — reproduced locally on the recorded Windows build and tool
    versions with the recorded method, including the terminal-closed run (RF-S3).
  - `[Assumption]` — expected but not measured, or supported only by
    documentation or community examples.
  - `[Rejected]` — tested and failed, or contradicted by measurement. Keep the
    record; do not delete a rejected route.

## Required evidence checklist

| Task | Area | Required evidence | Status |
|---|---|---|---|
| 0.8 | Audio | At least two routes; cold and warm first-play latency; no audio device; missing file; AV/EDR observation; terminal-closed run; proof that no event text reaches the command line | Complete — S3-A01–A07; no-device arm blocked (no admin) |
| 0.9 | TTS | Text delivered via stdin; voice enumeration; rate and volume control; hostile-string test; no voice installed; time-to-first-audio; cancellation; terminal-closed run | Complete — S3-TTS-01–09; zero-voice system unavailable |
| 0.10 | Toast | Per-user registration without admin; every registry key and file documented for uninstall; markup escaping; Focus Assist / Do Not Disturb and disabled-notification states; submitted vs seen; terminal-closed run; second Windows build if available | Complete with limits — S3-TO-01–11; DND-on and second build blocked |
| 0.11 | Focus | Foreground-window detection on Windows Terminal, VS Code, and a classic console host; false positives/negatives; click-to-focus without synthesized input; Q-06 and Q-07 answers | Partial — S3-F-01–04; VS Code attribution and real toast activation blocked |
| 0.12 | Provider selection | Selection matrix against the PRD §10 criteria; Q-05 decision and rationale | Complete — below |

## Records

No records yet. Append records below in task order and update the checklist
status.

## Audio records (S3-A)

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


## TTS records (S3-TTS)

IDs in this section are re-prefixed from the shard to avoid colliding with the toast records.

## S3-TTS-01 — TTS voice enumeration

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

## S3-TTS-02 — TTS cold vs warm time-to-first-audio

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

## S3-TTS-03 — TTS rate and volume control

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

## S3-TTS-04 — TTS hostile string on stdin: no execution, no text mangling

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

## S3-TTS-05 — TTS with a missing / uninstalled voice

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

## S3-TTS-06 — TTS with no audio endpoint (`SetOutputToNull`)

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

## S3-TTS-07 — TTS cancellation and queue cancellation

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

## S3-TTS-08 — TTS with the invoking terminal closed (RF-S3)

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

## S3-TTS-09 — TTS AV/EDR observation (Windows Defender)

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


## Toast records (S3-TO)

IDs in this section are re-prefixed from the shard to avoid colliding with the TTS records.

## S3-TO-01 — pre-state and registration surface

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

## S3-TO-02 — templated toast with a hostile project name

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

## S3-TO-03 — control and bidi characters

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

## S3-TO-04 — per-app notifications disabled

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

## S3-TO-05 — global "Notifications" master toggle via registry

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

## S3-TO-06 — Focus Assist / Do Not Disturb / quiet hours

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

## S3-TO-07 — invoking terminal closed (RF-S3)

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

## S3-TO-08 — unregistered AUMID (does registration gate delivery?)

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

## S3-TO-09 — latency (3 warm samples, `SettleMs=0`, no screenshot)

| Sample | Process wall | In-script duration | `Show()` |
|---|---|---|---|
| 1 | 1367 ms | 276 ms | 12 ms |
| 2 | 1227 ms | 244 ms | 10 ms |
| 3 | 1197 ms | 259 ms | 8 ms |

- Conclusion: the WinRT submit itself is ~10 ms; PowerShell 5.1 startup and
  WinRT activation dominate (~1.2–1.4 s wall). This is host-side alert latency,
  not shim latency; a persistent host or native helper avoids most of it.
- Tag: **[Verified]**

## S3-TO-10 — second Windows build

- Checked: only this machine/build is accessible; Windows 11 Home cannot run
  Windows Sandbox, and no second build or VM is available to the non-admin
  session.
- Tag: **[Blocked]** — no second-build evidence. Do not claim cross-build
  behavior.

## S3-TO-11 — cleanup

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


## Focus records (S3-F)

## S3-F-01 — Can a background helper focus a window, and does it send input?

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

## S3-F-02 — Foreground → process/window mapping per host

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

## S3-F-03 — Windows Terminal topology: windows, tabs, panes, and session→HWND

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

## S3-F-04 — Click-to-focus without delivering input

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
  (S3-F-02).
- Reliability fails at *session attribution*, not at detection:
  - Tabs/panes inside one WT window share one HWND and one PID (S3-F-03). F13-R1 is
    window-scoped, so suppressing all sessions in that window is literally
    compliant, but an alert for a background pane is suppressed while the user
    looks at another pane.
  - Two WT windows can share one PID (S3-F-03), and two VS Code windows do share one
    PID (S3-F-02). Matching by process name/PID then produces **false positives**
    (alert suppressed because a *different* window of the same app is focused).
  - VS Code exposes no session→HWND mapping to extensions. A per-window identity
    cannot be obtained from the extension APIs tested here.
- Exact session→window mapping **is** available for terminal hosts:
  `GetConsoleWindow()` → `GW_OWNER` resolves to the hosting WT top-level HWND;
  for a classic console the console window itself is the top-level window
  (S3-F-03). Compare `foreground HWND == session HWND` instead of comparing PIDs.

**Observed/expected false positives and negatives**

| Case | Effect | Evidence |
|---|---|---|
| Two panes/tabs in one WT window | False positive: both sessions count as focused | S3-F-03 |
| Two WT windows on one PID | False positive if matching by PID | S3-F-03 (`pid 14008`) |
| Two VS Code windows on one PID | False positive if matching by PID | S3-F-02 (`pid 23044`) |
| Another app focused during a test | False negative in the sample (not a detector bug) | S3-F-02 window-1 0/5 |
| IME/TextInputHost or a shell flyout foreground while typing in a terminal | Expected false negative (foreground HWND is not the host) | [Assumption] — not forced; `TextInputHost`/`Quick settings` windows were observed foreground during the session |
| Elevated terminal / UIPI | Not tested | [Blocked] |

## Q-07 — Can a toast activation bring the terminal/editor forward without input?

**Answer: feasible with window-management APIs and no input, but the toast grant
itself is unverified on this branch.**

- All routes tested used only `SetForegroundWindow`, `BringWindowToTop`,
  `ShowWindow`, `SetFocus`, `AttachThreadInput`, `SwitchToThisWindow`,
  `AllowSetForegroundWindow`, UIA `SetFocus`. No input API exists in the scripts.
- Background helpers are blocked by the foreground lock: `plain`, `attach`,
  `allow`, `switch`, UIA failed while another app held a fresh foreground (S3-F-01).
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


## Task 0.12 — Q-05 provider selection

Selection criteria (PRD §10): works unpackaged and per-user without admin; no
string-interpolated shell; low startup latency; not flagged by common AV/EDR;
no cloud.

| Provider | Chosen mechanism | Measured latency | Failure / suppression evidence | Decision |
|---|---|---|---|---|
| Sound | **In-process Node `winmm` MCI via `koffi@3.3.3`** (primary); fixed PowerShell `System.Media.SoundPlayer` script with a pinned WAV path (fallback) | MCI spawn→accepted p50 278 ms; steady ~85 ms/start. SoundPlayer spawn→accepted p50 488 ms; steady 0.62 ms/queued start | Missing/corrupt files produce typed MCI codes / catchable .NET exceptions; Defender 0 detections; no event text on a command line; RF-S3 passes | **Decided** |
| TTS | **Fixed PowerShell `System.Speech.Synthesis.SpeechSynthesizer`**, UTF-8 text read as bytes from **stdin**, resident worker/synthesizer; never `[Console]::In` and never interpolation | Spawn→first audio p50 841 ms; warm in-process 199–211 ms; cancel ~0.38 s | Hostile string (`"; rm -rf ~ #` + bidi) matched SHA-256, no canary executed, no mangling; missing/disabled voice caught; Defender 0 detections; RF-S3 passes | **Decided** |
| Toast | **Per-user AUMID + Start Menu shortcut + WinRT `ToastNotificationManager` `ToastGeneric`**, fixed PowerShell sender reading JSON payload from **stdin**, resident worker preferred; fixed script fallback | Submit ~10 ms; PowerShell spawn 1.2–1.4 s | Hostile project name rendered as literal text; app-disable suppresses delivery; terminal-closed run succeeds; cleanup verified; DND-on suppression and second build not measured | **Decided** |

### Rationale and limits

- **Sound:** MCI/koffi removes a process spawn and console from the hot path and
  is still a local Win32 call. The fixed SoundPlayer script is the proven
  dependency-free fallback if the native module fails to load or is blocked by
  EDR. Both routes keep the WAV path pinned to a bundled asset; event text is
  never a path or command-line argument. `koffi` must be validated in the
  packaged host under `npm ci --ignore-scripts`; if it fails, use the fallback.
- **TTS:** The fixed script + stdin design is the security win: the hostile
  fixture proved no command execution and exact UTF-8 text. A resident worker is
  required to keep warm latency near 0.2 s; cold spawn is ~0.85 s and remains
  inside the 1000 ms dispatch budget only as best-effort.
- **Toast:** Registration is per-user and admin-free. The toast API only proves
  submission, not that a human saw it; record `submitted`, never `seen`
  (F6-R10). `doctor` must check the AUMID key, shortcut, per-app `Enabled`
  value, and `FocusSessionManager.IsFocusActive`; it must not trust
  `ToastNotifier.Setting` (stale after app-disable).
- **Suppression:** Per-app disable is verified; global registry toggling is
  rejected as a simulation. DND-on suppression is `[Blocked]` because there is
  no programmatic setter and the shared desktop could not be toggled reliably.
  Detection of DND state is verified.
- **AV/EDR:** Defender only; third-party EDR and a second Windows build remain
  untested. These are deployment risks, not reasons to leave Q-05 open.

**Q-05 answer:** Decided as above. Update PRD §10 audio/TTS/toast row from Open
to Decided and record the residual validation items in §23.2.

## Q-06 / Q-07 / F13 decision

- **Q-06 — foreground detection:** answered with a capability gate. Window and
  process detection is reliable (15/15 stable samples), but session attribution
  is not reliable by PID. Windows Terminal and classic console can resolve the
  session's own top-level HWND through `GetConsoleWindow()` (+ `GW_OWNER` for
  WT), which makes window-level focus suppression exact. VS Code exposes no
  session→HWND mapping and two windows shared one PID, so F13 is **documented
  unsupported** for VS Code under F13-R2. Tabs/panes inside one WT window share
  an HWND; suppression is window-scoped, not pane-scoped, and that limitation is
  documented.
- **Q-07 — click-to-focus:** **not verified end-to-end.** All tested routes used
  only window-management APIs and delivered no input (canary windows logged zero
  keys/mouse). Background `SetForegroundWindow` is blocked by the foreground
  lock; attaching to the foreground thread succeeded 4/4 as a no-input fallback.
  A real toast activation was not tested because the toast branch's AUMID was
  not present in the focus branch. Keep click-to-focus out of the MVP; do not
  implement task 4.9 until a registered-toast activation probe confirms the
  grant and the follow-up focus.
- **F13 status:** supported with a per-host capability gate for Windows Terminal
  and classic console; unsupported for VS Code; `doctor` must report the
  capability and `focus.enabled` must default off where unsupported. Pane-level
  precision is not claimed.
