import type { SessionRecord } from "@agent-attention/core";

export interface StatusSession {
  adapterId: string;
  agentName: string;
  projectName?: string;
  sessionIdShort: string;
  state: SessionRecord["state"];
  stateConfidence: SessionRecord["stateConfidence"];
  lastEventAt: string;
  parentSessionId?: string;
  pendingRequests: Array<{ kind: string; requestId?: string; ageSeconds: number }>;
}

export interface StatusReport { schemaVersion: 1; generatedAt: string; sessions: StatusSession[]; }
export interface StatusQueries {
  listSessions(): SessionRecord[];
  openRequests(): Array<{ adapterId: string; sessionId: string; requestId: string; kind: string; openedAt: string }>;
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : `${sessionId.slice(0, 8)}…${sessionId.slice(-3)}`;
}

export function buildStatusReport(store: StatusQueries, now: string): StatusReport {
  const nowMs = Date.parse(now);
  const pending = store.openRequests();
  return {
    schemaVersion: 1,
    generatedAt: now,
    sessions: store.listSessions().map((session) => ({
      adapterId: session.adapterId,
      agentName: session.agentName,
      ...(session.projectName === undefined ? {} : { projectName: session.projectName }),
      sessionIdShort: shortSessionId(session.sessionId),
      state: session.state,
      stateConfidence: session.stateConfidence,
      lastEventAt: session.lastEventAt,
      ...(session.parentSessionId === undefined ? {} : { parentSessionId: session.parentSessionId }),
      pendingRequests: pending
        .filter((request) => request.adapterId === session.adapterId && request.sessionId === session.sessionId)
        .map((request) => ({ kind: request.kind, requestId: request.requestId, ageSeconds: Math.max(0, Math.floor((nowMs - Date.parse(request.openedAt)) / 1000)) })),
    })),
  };
}

export function formatStatusReport(report: StatusReport): string {
  if (report.sessions.length === 0) return "No active sessions.";
  return report.sessions.map((session) => {
    const project = session.projectName === undefined ? "" : ` — ${session.projectName}`;
    const pending = session.pendingRequests.length === 0 ? "" : `\n  pending: ${session.pendingRequests.map((item) => `${item.kind} (${item.ageSeconds}s)`).join(", ")}`;
    return `${session.agentName}${project} [${session.sessionIdShort}]\n  state: ${session.state} (${session.stateConfidence})\n  last event: ${session.lastEventAt}${pending}`;
  }).join("\n");
}
