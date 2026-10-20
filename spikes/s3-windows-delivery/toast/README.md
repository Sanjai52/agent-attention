# S3 Task 0.10 — per-user Windows toast identity prototype (throwaway)

Question: can Agent Attention register a per-user toast identity **without admin**
and submit a toast with escaped, templated text, and what does the API report when
notifications are suppressed?

**Throwaway code — do not promote.** The production provider is written against
PRD §12–§14/§17.2.

## Files

| File | Purpose |
|---|---|
| `register.ps1` | Creates the AUMID registry key + Start Menu shortcut carrying `System.AppUserModel.ID`. Idempotent. |
| `unregister.ps1` | Removes exactly what `register.ps1` created and verifies absence. Idempotent. |
| `global-state.ps1` | Saves/restores the global notification master toggle for suppression tests. |
| `clear-history.ps1` | Clears per-AUMID toast history after the test (uninstall cleanup). |
| `send-toast.ps1` | Fixed script; reads a JSON payload from **stdin**, builds toast XML through the WinRT DOM (no string interpolation), submits, captures screenshot/history. |
| `launcher.vbs` | Starts `send-toast.ps1` hidden from a closed terminal with payload on stdin (RF-S3). |
| `snapshot.ps1` | Records registry/shortcut/notification-state pre- and post-state for evidence. |
| `window-probe.ps1` | Enumerates top-level windows to detect a visible toast surface. |

## Reproduce

```powershell
.\register.ps1
Get-Content .\payload.json -Raw | .\send-toast.ps1 -ResultPath ..\out\toast-result.json
.\unregister.ps1
```

Payload (stdin) fields: `aumid`, `title`, `body`, `project`, `timestamp`.

Constraints exercised: no admin, no cloud, no event-derived text on any command
line (payload is stdin-only), hostile project name with XML metacharacters.
