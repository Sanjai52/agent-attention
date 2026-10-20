# S3 audio playback probes (throwaway)

Task 0.8. Answers: which Windows-native sound route meets PRD §10 (works
unpackaged, no string-interpolated shell, low startup latency, not AV-flagged, no
cloud), and how does it fail.

**Throwaway code — do not promote.** Production providers are rewritten against
PRD §12–§14.

## Routes

| Route | Entry point            | Mechanism                                                                                  |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------ |
| A     | `play-soundplayer.ps1` | Fixed PowerShell script, `System.Media.SoundPlayer`, WAV path passed as `-Path` parameter  |
| B     | `play-mci.mjs`         | Node in-process `winmm.dll` MCI (`mciSendStringW`) via `koffi`; no shell, no child process |

`run-detached.mjs` is a failed RF-S3 attempt (the harness kills the process
tree; kept as evidence). `trigger-rfs3.ps1` + `run-rfs3.ps1` are the working
RF-S3 path: WMI `Win32_Process.Create` makes the child a child of
`WmiPrvSE.exe`, outside the invoking terminal.

## Reproduce

Working directory: `spikes/s3-windows-delivery`.

```powershell
# Test asset
node audio/gen-tone.mjs out/tone-600ms.wav 0.6 660

# Route A
powershell -NoProfile -ExecutionPolicy Bypass -File audio/play-soundplayer.ps1 -Path "out/tone-600ms.wav" -Repeat 3

# Route B (installs koffi 3.3.3 into the repo root node_modules; gitignored)
npm install --no-save --no-package-lock koffi@3.3.3
node audio/play-mci.mjs out/tone-600ms.wav 3

# Cold/warm timing (fresh process each run)
node audio/time-first-play.mjs "out/tone-600ms.wav" 6

# Missing / corrupt file paths
node audio/measure-audio.mjs "out/tone-600ms.wav" 5

# Terminal-closed (RF-S3)
powershell -NoProfile -ExecutionPolicy Bypass -File audio/trigger-rfs3.ps1 -Route soundplayer
powershell -NoProfile -ExecutionPolicy Bypass -File audio/trigger-rfs3.ps1 -Route mci
```

Artifacts land in `out/` (gitignored). See
`docs/spikes/phase-0-shards/s3-audio-tts.md` for measurements.

## Safety notes

- The only variable input to route A is `-Path`, an app-controlled asset path.
  The fixed script has no `Invoke-Expression`/`Invoke-Command` and never builds
  command text from input. `SoundPlayer.SoundLocation` also accepts URLs, so
  production MUST restrict it to a fixed local asset.
- Route B passes the path as a Win32 API string, not shell text. Windows
  filenames cannot contain `"`, so quoting the path in the MCI command cannot be
  escaped by a filename.
- No event-derived text reaches either command line.
