import {
  AGENT_EVENT_TYPES,
  type AdapterCapabilities,
  type AgentEventType,
  type EventCapability,
  type SupportLevel,
} from "@agent-attention/contract";
import { CLAUDE_CODE_ADAPTER_ID, CLAUDE_CODE_ADAPTER_VERSION, CLAUDE_CODE_HOST_VERSION_RANGE } from "./types";

const VERIFIED_AGAINST = "Claude Code 2.1.181";
interface CapabilityEntry { support: SupportLevel; sourceSignal?: string; notes?: string; }

const EVENT_CAPABILITIES: Record<AgentEventType, CapabilityEntry> = {
  "agent.started": { support: "authoritative", sourceSignal: "SessionStart" },
  "agent.progress": { support: "unsupported", notes: "No verified progress hook." },
  "agent.needs_input": { support: "unsupported", notes: "Plain questions are not distinguishable from hook metadata." },
  "agent.needs_approval": { support: "authoritative", sourceSignal: "PermissionRequest" },
  "agent.approval_resolved": { support: "inferred", sourceSignal: "PostToolUse", notes: "Execution after PermissionRequest is an inferred approval; denial has no reliable resolution hook." },
  "agent.resumed": { support: "unsupported", notes: "No verified resume hook." },
  "agent.turn_ended": { support: "inferred", sourceSignal: "Stop", notes: "Stop is a turn boundary, never completion." },
  "agent.completed": { support: "unsupported", notes: "No verified successful-completion hook." },
  "agent.failed": { support: "authoritative", sourceSignal: "StopFailure | PostToolUseFailure" },
  "agent.session_ended": { support: "authoritative", sourceSignal: "SessionEnd" },
  "agent.state_unknown": { support: "unsupported", notes: "Unknown state is host-owned." },
};

function toEventCapability(entry: CapabilityEntry): EventCapability {
  return { support: entry.support, ...(entry.sourceSignal === undefined ? {} : { sourceSignal: entry.sourceSignal }), ...(entry.support === "unsupported" ? {} : { verifiedAgainst: VERIFIED_AGAINST }), ...(entry.notes === undefined ? {} : { notes: entry.notes }) };
}

export function capabilitiesFor(_hostVersion = "2.1.181"): AdapterCapabilities {
  const events = Object.fromEntries(AGENT_EVENT_TYPES.map((eventType) => [eventType, toEventCapability(EVENT_CAPABILITIES[eventType])])) as Record<AgentEventType, EventCapability>;
  return { adapterId: CLAUDE_CODE_ADAPTER_ID, adapterVersion: CLAUDE_CODE_ADAPTER_VERSION, hostVersionRange: CLAUDE_CODE_HOST_VERSION_RANGE, executionModel: "hook_process", events, eventIdsStable: false, supportsSequence: false, supportsTaskScope: false, supportsSubagents: false, supportsLiveness: false, supportsResolutionSignals: false };
}

export function assertEmittable(capabilities: AdapterCapabilities, eventType: AgentEventType): void {
  const capability = capabilities.events[eventType];
  if (capability === undefined || capability.support === "unsupported") throw new Error(`adapter ${capabilities.adapterId} cannot emit unsupported event type ${eventType}`);
}
