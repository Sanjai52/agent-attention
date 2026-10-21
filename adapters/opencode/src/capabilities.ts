/**
 * Capability declaration for OpenCode v2.0.32 (PRD.md §16.2).
 *
 * Only signals observed in the frozen S1 fixtures are declared. Any event type
 * without a verified host signal is `unsupported`; `assertEmittable` is the
 * hard guard that keeps a normalizer from claiming more than the host proved.
 */

import {
  AGENT_EVENT_TYPES,
  type AdapterCapabilities,
  type AgentEventType,
  type EventCapability,
  type SupportLevel,
} from "@agent-attention/contract";

import {
  OPENCODE_ADAPTER_ID,
  OPENCODE_ADAPTER_VERSION,
  OPENCODE_HOST_VERSION_RANGE,
} from "./types";

const VERIFIED_AGAINST = "OpenCode v2.0.32";

interface CapabilityEntry {
  support: SupportLevel;
  sourceSignal?: string;
  notes?: string;
}

const EVENT_CAPABILITIES: Record<AgentEventType, CapabilityEntry> = {
  "agent.started": {
    support: "authoritative",
    sourceSignal: "session.execution.started",
  },
  "agent.progress": {
    support: "authoritative",
    sourceSignal: "session.step.started",
    notes: "Coarse progress only; step deltas and payloads are ignored.",
  },
  "agent.needs_input": {
    support: "unsupported",
    notes: "The question tool was not verified on OpenCode v2.0.32.",
  },
  "agent.needs_approval": {
    support: "authoritative",
    sourceSignal: "permission.asked",
  },
  "agent.approval_resolved": {
    support: "authoritative",
    sourceSignal: "permission.replied",
  },
  "agent.resumed": {
    support: "unsupported",
    notes: "No verified resume signal on OpenCode v2.0.32.",
  },
  "agent.turn_ended": {
    support: "inferred",
    sourceSignal: "session.execution.interrupted",
    notes: "Interruption is a turn end, not a verified success or failure.",
  },
  "agent.completed": {
    support: "authoritative",
    sourceSignal: "session.execution.succeeded",
  },
  "agent.failed": {
    support: "authoritative",
    sourceSignal: "session.execution.failed",
  },
  "agent.session_ended": {
    support: "unsupported",
    notes: "No verified session-end signal on OpenCode v2.0.32.",
  },
  "agent.state_unknown": {
    support: "unsupported",
    notes: "No verified unknown-state signal on OpenCode v2.0.32.",
  },
};

function toEventCapability(entry: CapabilityEntry): EventCapability {
  return {
    support: entry.support,
    ...(entry.sourceSignal === undefined ? {} : { sourceSignal: entry.sourceSignal }),
    ...(entry.support === "unsupported" ? {} : { verifiedAgainst: VERIFIED_AGAINST }),
    ...(entry.notes === undefined ? {} : { notes: entry.notes }),
  };
}

/**
 * Return the declaration for the connected host. The parameter is kept so a
 * future host-range gate can downgrade declarations without changing callers;
 * v2.0.32 is the only version verified today.
 */
export function capabilitiesFor(_hostVersion: string): AdapterCapabilities {
  const events = Object.fromEntries(
    AGENT_EVENT_TYPES.map((eventType) => [
      eventType,
      toEventCapability(EVENT_CAPABILITIES[eventType]),
    ]),
  ) as Record<AgentEventType, EventCapability>;

  return {
    adapterId: OPENCODE_ADAPTER_ID,
    adapterVersion: OPENCODE_ADAPTER_VERSION,
    hostVersionRange: OPENCODE_HOST_VERSION_RANGE,
    executionModel: "in_process_plugin",
    events,
    eventIdsStable: true,
    supportsSequence: true,
    supportsTaskScope: false,
    supportsSubagents: true,
    supportsLiveness: true,
    supportsResolutionSignals: true,
  };
}

/** Throw when an event type is not supported by this adapter. */
export function assertEmittable(
  capabilities: AdapterCapabilities,
  eventType: AgentEventType,
): void {
  const capability = capabilities.events[eventType];
  if (capability === undefined || capability.support === "unsupported") {
    throw new Error(
      `adapter ${capabilities.adapterId} cannot emit unsupported event type ${eventType}`,
    );
  }
}
