# S3 — Windows Delivery

Scaffold created by Task 0.1; populated by Tasks 0.8–0.12.

- Results: [`../../docs/spikes/s3-results.md`](../../docs/spikes/s3-results.md)
- Decisions: PRD §10, §23.1, §23.2 (Q-05, Q-06, Q-07)

## Question answered

Which Windows-native mechanisms deliver sound, speech, toast notifications, and
focus restoration while meeting the PRD §10 constraints — works unpackaged, no
admin, no cloud, no string interpolation of event text, low startup latency, and
not blocked by AV/EDR?

- **Q-05:** which sound, TTS, and toast routes are selected?
- **Q-06:** is foreground-window detection reliable enough for F13?
- **Q-07:** can toast activation bring the terminal/editor forward without sending
  input?

## Time box

| Task | Area | Box |
|---|---|---|
| 0.8 | Audio playback routes | 0.5 day |
| 0.9 | TTS | 0.5 day |
| 0.10 | Toast and unpackaged registration | 1 day |
| 0.11 | Focus/foreground detection and click-to-focus | 0.5 day |
| 0.12 | Provider selection (Q-05) | 0.5 day |

Stop at the box, record the partial result, and escalate. Do not extend a spike to
make a provider look better.

## Method

1. Prototype at least two audio routes: PowerShell `System.Media.SoundPlayer` with
   a fixed script and a file path passed as a parameter, plus a Node-native route
   if one is viable unpackaged.
2. Prototype TTS with Windows SAPI / `System.Speech.Synthesis.SpeechSynthesizer`
   from a fixed PowerShell script, delivering the text via **stdin** (never
   interpolated).
3. Register a toast identity per user without admin, document every registry key
   and file created, and verify markup escaping with a hostile project name.
4. Test suppression (Focus Assist / Do Not Disturb, app notifications disabled,
   quiet hours) and distinguish *submitted* from *seen*.
5. Detect the foreground window and map it to the owning process/terminal; test
   Windows Terminal, VS Code, and one classic console host. Attempt click-to-focus
   and verify no keystrokes are delivered.
6. Measure cold and warm latency, no-device/no-file/no-voice behavior, and
   cancellation. Note whether AV/EDR flags any invocation.

## How to reproduce

Exact command lines and script paths are recorded in each experiment record in
`docs/spikes/s3-results.md`. In general:

1. Use the recorded Windows build and PowerShell 5.1/Node versions.
2. Run each fixed script with the recorded arguments; keep output and timing data
   under `out/` (gitignored).
3. **Re-run every delivery test with the invoking terminal closed** (RF-S3); an
   interactive-only success is not evidence.
4. For toast registration, record the pre-state and every key/file created so
   `uninstall` can reverse it.
5. For TTS, pass hostile text (`"; rm -rf ~ #` plus RTL override characters) via
   stdin and verify it is spoken as text with no command execution.
6. For focus tests, record false positives/negatives and confirm no synthesized
   input.

## Outputs

- `docs/spikes/s3-results.md` — experiment records and the provider selection
  matrix.
- PRD §10/§23.1/§23.2 — Q-05/Q-06/Q-07 answers and the F13 decision.
- `out/` — recordings, logs, screenshots, measurement output (gitignored).

## Throwaway code — do not promote

The PowerShell, C#, and Node prototypes exist only to prove the mechanisms. The
production providers are written against PRD §12–§14 with fixed commands,
stdin-only text, and no event-derived interpolation; no spike script may be
promoted as-is.
