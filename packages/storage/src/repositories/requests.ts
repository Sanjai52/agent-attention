/**
 * Pending input/approval requests (PRD.md §13.3, §15.1).
 *
 * Open requests are the ones notifications and reminders care about; resolved
 * rows stay behind as history until retention removes them.
 */

import type { PendingRequest, PendingRequestKind } from "@agent-attention/core";
import type { AgentAttentionDb } from "../db";
import { validateTimestamp } from "../time";

export interface OpenRequestRecord {
  adapterId: string;
  sessionId: string;
  requestId: string;
  kind: PendingRequestKind;
  openedAt: string;
  remindersSent: number;
}

interface RequestRow {
  adapter_id: string;
  session_id: string;
  request_id: string;
  kind: string;
  opened_at: string;
  reminders_sent: number | bigint;
}

export interface RequestRepository {
  listOpen(): OpenRequestRecord[];
  listOpenForSession(adapterId: string, sessionId: string): PendingRequest[];
  purgeResolvedBefore(cutoff: string): number;
}

export function createRequestRepository(db: AgentAttentionDb): RequestRepository {
  const listOpen = db.raw.prepare(`
    SELECT adapter_id, session_id, request_id, kind, opened_at, reminders_sent
      FROM pending_requests
     WHERE resolved_at IS NULL
     ORDER BY rowid ASC
  `);
  const listForSession = db.raw.prepare(`
    SELECT request_id, kind, opened_at, reminders_sent
      FROM pending_requests
     WHERE adapter_id = ? AND session_id = ? AND resolved_at IS NULL
     ORDER BY rowid ASC
  `);
  const purge = db.raw.prepare(
    "DELETE FROM pending_requests WHERE resolved_at IS NOT NULL AND julianday(resolved_at) < julianday(?)",
  );

  return {
    listOpen() {
      const rows = listOpen.all() as unknown as RequestRow[];
      return rows.map((row) => ({
        adapterId: row.adapter_id,
        sessionId: row.session_id,
        requestId: row.request_id,
        kind: row.kind as PendingRequestKind,
        openedAt: row.opened_at,
        remindersSent: Number(row.reminders_sent),
      }));
    },

    listOpenForSession(adapterId, sessionId) {
      const rows = listForSession.all(adapterId, sessionId) as unknown as Array<
        Omit<RequestRow, "adapter_id" | "session_id">
      >;
      return rows.map((row) => ({
        kind: row.kind as PendingRequestKind,
        requestId: row.request_id,
        openedAt: row.opened_at,
        remindersSent: Number(row.reminders_sent),
      }));
    },

    purgeResolvedBefore(cutoff) {
      return Number(purge.run(validateTimestamp(cutoff, "cutoff")).changes);
    },
  };
}
