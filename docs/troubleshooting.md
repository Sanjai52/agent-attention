# Troubleshooting

Status: scaffold. Expanded in Phase 2 (doctor glossary), Phase 3/5 (host sections),
and finalized in Phase 6 Task 6.6.
Source of truth: `PRD.md` §7.1, §17.5, F11-R1.

## Doctor glossary

[Filled in Phase 2 Task 2.14 and surfaced by Phase 4 Task 4.7: each check, what a
warn/fail means, and the fix command.]

## Common situations (to be filled)

- No alerts at all: host not running, global mute, quiet hours, focus suppression, channel disabled
- Alerts but no sound: audio device unavailable, sound file invalid, volume 0
- No voice: voice disabled per event, no TTS voice installed, unsafe name omitted
- No toasts: registration missing, Focus Assist/DND, notifications disabled for the app
- Agent runs under WSL/SSH/container: unsupported environment (D-09), what to expect
- Host restarted: sessions show `unknown` until new activity (PRD §13.4)
- Deduplicated what looked like two events: fingerprint explanation (PRD §14.4)

## Host-specific notes

[Phase 3 Task 3.8 / Phase 5 Task 5.6]

## Dogfood journal

See `dogfood-journal.md` (created in Phase 4 Task 4.14).
