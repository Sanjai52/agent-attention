import type { AgentEventType, EventConfidence } from "@agent-attention/contract";

function shortSessionId(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : `${sessionId.slice(0, 8)}…${sessionId.slice(-3)}`;
}

export interface HistoryEvent {
  eventId: string; adapterId: string; sessionIdShort: string; eventType: AgentEventType;
  confidence: EventConfidence; occurredAt: string; receivedAt: string; summaryCode?: string;
  late: boolean; deliveries: Array<{ channel: string; status: string; reason?: string }>;
}
export interface HistoryReport { schemaVersion: 1; events: HistoryEvent[]; }
export interface HistorySource { listEvents(filters: Record<string, unknown>): Array<Record<string, unknown>>; listDeliveries(eventId: string): Array<Record<string, unknown>>; }

export function buildHistoryReport(source: HistorySource, filters: Record<string, unknown> = {}): HistoryReport {
  return { schemaVersion: 1, events: source.listEvents(filters).map((event) => ({
    eventId: String(event.eventId), adapterId: String(event.adapterId), sessionIdShort: shortSessionId(String(event.sessionId)),
    eventType: event.eventType as AgentEventType, confidence: event.confidence as EventConfidence,
    occurredAt: String(event.occurredAt), receivedAt: String(event.receivedAt),
    ...(typeof event.summaryCode === "string" ? { summaryCode: event.summaryCode } : {}), late: event.late === true,
    deliveries: source.listDeliveries(String(event.eventId)).map((delivery) => ({ channel: String(delivery.channel), status: String(delivery.status), ...(typeof delivery.reason === "string" ? { reason: delivery.reason } : {}) })),
  })) };
}

export function formatHistoryReport(report: HistoryReport): string {
  return report.events.map((event) => `${event.occurredAt} ${event.eventType} ${event.adapterId}/${event.sessionIdShort} ${event.deliveries.map((item) => `${item.channel}:${item.status}${item.reason === undefined ? "" : `(${item.reason})`}`).join(", ")}`).join("\n");
}
