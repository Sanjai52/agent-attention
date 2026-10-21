# Phase 4 Acceptance Matrix

This matrix records the current Phase 4 integration evidence on
`phase-4-policy-cli-history`.

| PRD area | Evidence | Status |
| --- | --- | --- |
| F4/F5 | Existing provider, queue, template, mute, and preview tests | Verified in suite |
| F6 | Existing toast/provider and delivery isolation tests | Verified in suite |
| F7 | Status/history report models and storage query contracts | Verified; CLI host wiring remains bounded to supported IPC commands |
| F8 | Quiet-hours, dedupe, rate-limit, and delivery suppression tests | Verified in core/integration suite |
| F9/F10 | Failure and turn-end state/precedence tests | Verified in core suite |
| F11 | CLI IPC client, JSON output, config commands, exit codes, and doctor report transport | Verified; doctor IPC routing has a dedicated host-connection test |
| F12 | Audio queue, coalescing, and rate limiting tests | Verified in core/notification suite |
| F13 | Focus provider capability and unsupported-environment reporting | **Unsupported for this release**; session-to-window host mapping is not available in the current event contract, so alerts are never suppressed by focus |
| F14 | Reminder planning and timer arming | Verified in core; timer delivery callback remains host-runtime supplied |
| F15 | Standard/discreet privacy rendering and metadata retention | Verified in core/template suite |
| Retention | Startup and hourly purge scheduling | Implemented; storage safety is covered by existing purge tests |
| Dogfooding | Local stats report and journal template | Implemented; no network or telemetry path |

## Verification

- 51 test files passed.
- 586 tests passed.
- Workspace typechecks passed.
- Lint passed.
- Dependency check passed.
- Production build passed.
- Phase 4 acceptance timer test passed for reminder firing; focus fallback is
  explicitly non-suppressing when unsupported.

The matrix intentionally distinguishes implemented evidence from host-specific
integration limits. No unsupported capability is claimed as measured behavior.
