/**
 * Event history (PRD.md §14.2, §15.1).
 *
 * Only enumerated contract fields are persisted. `details_json` is built from
 * an allowlist so free text can never leak into storage (PRD §15.2).
 */

import type {
  AgentEvent,
  AgentEventDetails,
  AgentEventType,
  EventConfidence,
} from "@agent-attention/contract";
import type { AgentAttentionDb } from "../db";
import { validateTimestamp } from "../time";

export interface EventRecordMeta {
  fingerprint: string;
  late: boolean;
  duplicate: boolean;
}

export interface EventFilters {
  adapterId?: string;
  sessionId?: string;
  taskId?: string;
  eventType?: AgentEventType;
  requestId?: string;
  /** Inclusive lower bound on `occurred_at`. */
  from?: string;
  /** Inclusive upper bound on `occurred_at`. */
  to?: string;
  limit?: number;
}

export interface StoredEvent {
  id: number;
  eventId: string;
  adapterId: string;
  sessionId: string;
  taskId?: string;
  eventType: AgentEventType;
  summaryCode?: string;
  requestId?: string;
  sequence?: number;
  ingestSeq: number;
  occurredAt: string;
  receivedAt: string;
  confidence: EventConfidence;
  late: boolean;
  fingerprint: string;
  processedAt?: string;
  details?: AgentEventDetails;
}

export interface EventRepository {
  insert(event: AgentEvent, meta: EventRecordMeta, processedAt?: string): number;
  list(filters?: EventFilters): StoredEvent[];
  purgeReceivedBefore(cutoff: string): number;
}

const DETAIL_KEYS = [
  "summaryCode",
  "requestId",
  "completionScope",
  "resolution",
  "resumeReason",
  "failureCode",
  "turnDurationMs",
] as const satisfies ReadonlyArray<keyof AgentEventDetails>;

function serializeDetails(details: AgentEventDetails | undefined): string | null {
  if (details === undefined) {
    return null;
  }

  const selected: Record<string, unknown> = {};
  for (const key of DETAIL_KEYS) {
    const value = details[key];
    if (value !== undefined) {
      selected[key] = value;
    }
  }

  return Object.keys(selected).length === 0 ? null : JSON.stringify(selected);
}

function parseDetails(json: string | null): AgentEventDetails | undefined {
  if (json === null) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as AgentEventDetails;
  } catch {
    return undefined;
  }
}

interface EventRow {
  id: number | bigint;
  event_id: string;
  adapter_id: string;
  session_id: string;
  task_id: string | null;
  event_type: string;
  summary_code: string | null;
  request_id: string | null;
  sequence: number | bigint | null;
  ingest_seq: number | bigint;
  occurred_at: string;
  received_at: string;
  confidence: string;
  late: number | bigint;
  fingerprint: string;
  processed_at: string | null;
  details_json: string | null;
}

function mapEvent(row: EventRow): StoredEvent {
  return {
    id: Number(row.id),
    eventId: row.event_id,
    adapterId: row.adapter_id,
    sessionId: row.session_id,
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    eventType: row.event_type as AgentEventType,
    ...(row.summary_code === null ? {} : { summaryCode: row.summary_code }),
    ...(row.request_id === null ? {} : { requestId: row.request_id }),
    ...(row.sequence === null ? {} : { sequence: Number(row.sequence) }),
    ingestSeq: Number(row.ingest_seq),
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    confidence: row.confidence as EventConfidence,
    late: Number(row.late) !== 0,
    fingerprint: row.fingerprint,
    ...(row.processed_at === null ? {} : { processedAt: row.processed_at }),
    ...(row.details_json === null ? {} : { details: parseDetails(row.details_json) }),
  };
}

export function createEventRepository(db: AgentAttentionDb): EventRepository {
  const insert = db.raw.prepare(`
    INSERT INTO agent_events (
      event_id, adapter_id, session_id, task_id, event_type,
      summary_code, request_id, sequence, ingest_seq, occurred_at,
      received_at, confidence, late, fingerprint, processed_at, details_json
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, (SELECT COALESCE(MAX(ingest_seq), 0) + 1 FROM agent_events), ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  const purge = db.raw.prepare(
    "DELETE FROM agent_events WHERE julianday(received_at) < julianday(?)",
  );

  return {
    insert(event, meta, processedAt) {
      const occurredAt = validateTimestamp(event.occurredAt, "event.occurredAt");
      const receivedAt = validateTimestamp(event.receivedAt, "event.receivedAt");
      const result = insert.run(
        event.eventId,
        event.source.adapterId,
        event.session.sessionId,
        event.session.taskId ?? null,
        event.eventType,
        event.details?.summaryCode ?? null,
        event.details?.requestId ?? null,
        event.sequence ?? null,
        occurredAt,
        receivedAt,
        event.confidence,
        meta.late ? 1 : 0,
        meta.fingerprint,
        processedAt ?? new Date().toISOString(),
        serializeDetails(event.details),
      );
      return Number(result.lastInsertRowid);
    },

    list(filters = {}) {
      const clauses: string[] = [];
      const params: Array<string | number> = [];

      if (filters.adapterId !== undefined) {
        clauses.push("adapter_id = ?");
        params.push(filters.adapterId);
      }
      if (filters.sessionId !== undefined) {
        clauses.push("session_id = ?");
        params.push(filters.sessionId);
      }
      if (filters.taskId !== undefined) {
        clauses.push("task_id = ?");
        params.push(filters.taskId);
      }
      if (filters.eventType !== undefined) {
        clauses.push("event_type = ?");
        params.push(filters.eventType);
      }
      if (filters.requestId !== undefined) {
        clauses.push("request_id = ?");
        params.push(filters.requestId);
      }
      if (filters.from !== undefined) {
        clauses.push("julianday(occurred_at) >= julianday(?)");
        params.push(validateTimestamp(filters.from, "from"));
      }
      if (filters.to !== undefined) {
        clauses.push("julianday(occurred_at) <= julianday(?)");
        params.push(validateTimestamp(filters.to, "to"));
      }

      let statement = "SELECT * FROM agent_events";
      if (clauses.length > 0) {
        statement += ` WHERE ${clauses.join(" AND ")}`;
      }
      statement += " ORDER BY ingest_seq ASC";

      if (filters.limit !== undefined) {
        statement += " LIMIT ?";
        params.push(Math.max(0, Math.trunc(filters.limit)));
      }

      const rows = db.raw.prepare(statement).all(...params) as unknown as EventRow[];
      return rows.map(mapEvent);
    },

    purgeReceivedBefore(cutoff) {
      return Number(purge.run(validateTimestamp(cutoff, "cutoff")).changes);
    },
  };
}
