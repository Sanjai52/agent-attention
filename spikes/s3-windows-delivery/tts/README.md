# S3 TTS probes (throwaway)

Task 0.9. Answers: can Windows SAPI deliver local speech from a fixed script
with text supplied only on stdin, what does it cost in latency, and does it fail
safely (hostile text, missing voice, cancellation)?

**Throwaway code — do not promote.**

## Scripts

| File                                    | Purpose                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `list-voices.ps1`                       | Enumerate installed SAPI voices                                                                           |
| `speak.ps1`                             | Fixed script; reads **UTF-8 bytes from stdin**, never interpolates text; modes `speak`, `cancel`, `queue` |
| `gen-hostile.mjs`                       | Writes the hostile UTF-8 fixture (no BOM, no trailing newline)                                            |
| `measure-tts.mjs`                       | Cold/warm timing, rate/volume, hostile, missing voice, null output, cancellation                          |
| `trigger-rfs3.ps1` + `run-rfs3-tts.mjs` | Terminal-closed run via WMI-owned Node process                                                            |

## Reproduce

Working directory: `spikes/s3-windows-delivery`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tts/list-voices.ps1
node tts/gen-hostile.mjs out
node tts/measure-tts.mjs

# Terminal-closed (RF-S3)
powershell -NoProfile -ExecutionPolicy Bypass -File tts/trigger-rfs3.ps1 -Text short
powershell -NoProfile -ExecutionPolicy Bypass -File tts/trigger-rfs3.ps1 -Text hostile
```

`out/` is gitignored.

## Findings that affect production

1. **Do not use `[Console]::In.ReadToEnd()`.** PowerShell 5.1 decodes stdin with
   the legacy console encoding: 126 UTF-8 characters arrived as 136 mojibake
   characters. `speak.ps1` reads `[Console]::OpenStandardInput()` bytes and
   decodes UTF-8 explicitly; the SHA-256 of the received text then matches the
   fixture exactly.
2. **Sanitize before speaking.** Bidi overrides and punctuation are spoken as
   characters/pauses (the 126-char hostile fixture took ~13 s to complete).
   Apply PRD §17.3 stripping of control and bidi characters before TTS.
3. **Cancellation is real.** `SpeakAsyncCancelAll()` produced
   `SpeakCompleted.Cancelled = true` ~0.4 s after the request.
4. **No text ever reaches a command line.** The script accepts only rate,
   volume, voice name, mode, and timing as parameters; speech text is stdin only.
