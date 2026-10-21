import type { AdapterCapabilities, AgentEvent, AgentEventDetails, AgentEventSession, AgentEventType, EventConfidence } from "@agent-attention/contract";
import { EVENT_SCHEMA_VERSION } from "@agent-attention/contract";
import { assertEmittable } from "../capabilities";
import { OPENCODE_ADAPTER_ID, OPENCODE_ADAPTER_VERSION, type AdapterHostContext, type OpenCodeEvent } from "../types";
import type { SessionTracker } from "./session";

export interface NormalizerEventContext { hostContext: AdapterHostContext; capabilities: AdapterCapabilities; tracker: SessionTracker; now: () => number; }

export function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function sessionIdOf(event: OpenCodeEvent): string | undefined { return readString(event.data, "sessionID") ?? event.durable?.aggregateID; }

function sourceOf(context: AdapterHostContext): AgentEvent["source"] {
  return { adapterId: OPENCODE_ADAPTER_ID, adapterVersion: OPENCODE_ADAPTER_VERSION, agentId: OPENCODE_ADAPTER_ID, agentName: "OpenCode", ...(context.app.version ? { agentVersion: context.app.version } : {}) };
}

export function buildEvent(ctx: NormalizerEventContext, sourceEvent: OpenCodeEvent, eventType: AgentEventType, confidence: EventConfidence, session: AgentEventSession, details?: AgentEventDetails): AgentEvent {
  assertEmittable(ctx.capabilities, eventType);
  const receivedAt = new Date(ctx.now()).toISOString();
  const date = new Date(sourceEvent.created);
  const occurredAt = Number.isNaN(date.getTime()) ? receivedAt : date.toISOString();
  return { schemaVersion: EVENT_SCHEMA_VERSION, eventId: sourceEvent.id, eventIdStability: "source", ...(sourceEvent.durable === undefined ? {} : { sequence: sourceEvent.durable.seq }), eventType, source: sourceOf(ctx.hostContext), session, occurredAt, receivedAt, confidence, ...(details === undefined || Object.keys(details).length === 0 ? {} : { details }) };
}
