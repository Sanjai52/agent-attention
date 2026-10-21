# Phase 3 Competitive and Integration Review

**Date:** 2026-10-21  
**Chosen host:** OpenCode v2.0.32  
**Decision:** Keep OpenCode as the first adapter.

## Approaches reviewed

| Approach | Strength | Limitation | Decision |
|---|---|---|---|
| OpenCode in-process plugin | Receives the structured event stream, permission events, durable sequence numbers, and session relationships without polling the terminal | Host API and event names can drift between versions | Selected; capability-gated and fixture-tested |
| Native host hooks | Simple installation model when a host exposes completion hooks | Hook payloads are host-specific, often process-bound, and can block or alter host behavior | Not the first integration; the shared shim remains available for hook-based adapters |
| Terminal bell / idle detection | Works with almost any terminal and has very low integration cost | Cannot distinguish approval, failure, cancellation, and verified completion; produces false positives | Retained only as a possible fallback, not a classified-event source |
| External relay or push service | Can notify outside the local machine and support multiple clients | Adds network credentials, privacy exposure, availability dependencies, and latency | Out of MVP scope; local Notification Host is the safer default |
| Agent-specific community plugins | May provide polished host UX quickly | Version ownership, payload leakage, and behavior are outside Agent Attention's control | Useful reference material, not a runtime dependency |

## Selection rationale

OpenCode remains the correct first host because the Phase 0 scorecard measured
the highest authoritative-signal coverage: approval request, approval
resolution, turn boundary, completion, and failure. The runtime probe also
confirmed an in-process event stream and durable per-session sequence numbers.

The adapter deliberately does not infer blocking input from ordinary text, does
not treat `session.idle` as a success signal, and does not pass commands,
messages, tool payloads, or model text into the shared event contract.

## Risks and controls

- Host event drift is controlled by the declared host version range, recorded
  fixtures, and capability downgrade rules.
- Permission-resolution drift is controlled by the explicit
  `permission.replied` mapping and the frozen approval fixtures.
- Plugin failure is isolated from OpenCode by bounded normalization and the
  shim's existing non-blocking delivery path.
- Privacy leakage is tested by serialized-event decoy assertions.

## Conclusion

No reviewed alternative provides the same combination of authoritative signals,
structured metadata, and local integration safety for this milestone. The
OpenCode adapter is therefore the justified first integration.
