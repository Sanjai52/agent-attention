import type { AdapterCapabilities, AgentEvent } from "@agent-attention/contract";
import { buildEvent, type NormalizerEventContext } from "./common";
import { SessionTracker } from "./session";
import type { AdapterHostContext, OpenCodeEvent } from "../types";

export interface NormalizerOptions { context: AdapterHostContext; capabilities: AdapterCapabilities; now?: () => number; }
export interface OpenCodeNormalizer { normalize(event: OpenCodeEvent): AgentEvent[]; }

export function createNormalizer(options: NormalizerOptions): OpenCodeNormalizer {
  const tracker = new SessionTracker();
  const ctx: NormalizerEventContext = { hostContext: options.context, capabilities: options.capabilities, tracker, now: options.now ?? Date.now };
  return { normalize(event) {
    if (tracker.hasSeen(event.id)) return [];
    tracker.markSeen(event.id);
    tracker.observe(event);
    if (event.type === "session.created") return [];
    const session = tracker.session(event, options.context);
    if (session === undefined) return [];
    switch (event.type) {
      case "session.execution.started": return [buildEvent(ctx, event, "agent.started", "authoritative", session)];
      case "session.step.started": return [buildEvent(ctx, event, "agent.progress", "authoritative", session)];
      case "session.execution.succeeded": return tracker.markTerminal(session.sessionId) ? [buildEvent(ctx, event, "agent.completed", "authoritative", session, { completionScope: "session" })] : [];
      case "session.execution.failed": return tracker.markTerminal(session.sessionId) ? [buildEvent(ctx, event, "agent.failed", "authoritative", session, { failureCode: "host_error" })] : [];
      case "session.execution.interrupted": return tracker.markTerminal(session.sessionId) ? [buildEvent(ctx, event, "agent.turn_ended", "inferred", session)] : [];
      case "permission.asked": {
        const requestId = typeof event.data?.id === "string" && event.data.id.length > 0 ? event.data.id : undefined;
        return [buildEvent(ctx, event, "agent.needs_approval", "authoritative", session, requestId === undefined ? undefined : { requestId })];
      }
      case "permission.replied": {
        const requestId = typeof event.data?.requestID === "string" && event.data.requestID.length > 0 ? event.data.requestID : undefined;
        const reply = typeof event.data?.reply === "string" ? event.data.reply : "unknown";
        const resolution = reply === "reject" || reply === "deny" ? "denied" : reply === "unknown" ? "unknown" : "approved";
        return [buildEvent(ctx, event, "agent.approval_resolved", "authoritative", session, { ...(requestId === undefined ? {} : { requestId }), resolution })];
      }
      default: return [];
    }
  } };
}
