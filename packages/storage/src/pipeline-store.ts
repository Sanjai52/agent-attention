/**
 * SQLite implementation of the core `PipelineStore` (PRD.md §14.2, §15).
 *
 * The normal pipeline call order is `claimFingerprint` then `recordEvent`.
 * SQLite's unique primary key on `dedupe_records.fingerprint` makes the claim
 * decision atomic across connections. `claimAndRecordEvent` is provided for
 * callers that want the claim and event insert in one transaction.
 */

import type { AgentEvent, ValidationIssue } from "@agent-attention/contract";
import type { PipelineDiagnostic, PipelineStore, SessionRecord } from "@agent-attention/core";
import type { AgentAttentionDb } from "./db";
import { StorageError, translateSqliteError } from "./errors";
import { createDedupeRepository, type ClaimFingerprintResult } from "./repositories/dedupe";
import { createDeliveryRepository, type DeliveryRecord } from "./repositories/deliveries";
import {
  createEventRepository,
  type EventFilters,
  type EventRecordMeta,
  type StoredEvent,
} from "./repositories/events";
import { createRequestRepository, type OpenRequestRecord } from "./repositories/requests";
import { createSessionRepository } from "./repositories/sessions";
import { cutoffBefore, normalizeTimestamp } from "./time";

export interface PipelineStoreOptions {
  /** PRD §15.2 `activityHistory.retentionDays` (default 7). */
  retentionDays: number;
}

export interface PurgeResult {
  dedupeRecords: number;
  events: number;
  deliveries: number;
  sessions: number;
  requests: number;
}

export interface AgentAttentionStore extends PipelineStore {
  readonly db: AgentAttentionDb;
  readonly diagnostics: readonly (ValidationIssue | PipelineDiagnostic)[];
  /**
   * Claim a fingerprint and insert the event row in the same SQLite
   * transaction. Duplicates only bump `duplicate_count`.
   */
  claimAndRecordEvent(
    event: AgentEvent,
    meta: EventRecordMeta,
    now: string,
  ): ClaimFingerprintResult;
  recordDelivery(delivery: DeliveryRecord): void;
  listSessions(): SessionRecord[];
  listEvents(filters?: EventFilters): StoredEvent[];
  listDeliveries(eventId: string): DeliveryRecord[];
  openRequests(): OpenRequestRecord[];
  purgeExpired(now: string): PurgeResult;
  close(): void;
}

const MAX_DIAGNOSTICS = 1000;

export function createPipelineStore(
  db: AgentAttentionDb,
  options: PipelineStoreOptions,
): AgentAttentionStore {
  if (!Number.isInteger(options.retentionDays) || options.retentionDays < 0) {
    throw new StorageError("invalid_input", "retentionDays must be a non-negative integer");
  }

  const dedupe = createDedupeRepository(db);
  const events = createEventRepository(db);
  const requests = createRequestRepository(db);
  const sessions = createSessionRepository(db, requests);
  const deliveries = createDeliveryRepository(db);
  const diagnostics: Array<ValidationIssue | PipelineDiagnostic> = [];

  function guard<T>(context: string, fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      throw translateSqliteError(error, context);
    }
  }

  return {
    db,
    diagnostics,

    claimFingerprint(fingerprint, eventId, now) {
      return guard("claim fingerprint", () => dedupe.claim(fingerprint, eventId, now));
    },

    claimAndRecordEvent(event, meta, now) {
      return guard("claim and record event", () =>
        db.transaction(() => {
          const claim = dedupe.claim(meta.fingerprint, event.eventId, now);
          if (claim.claimed) {
            events.insert(event, meta, now);
          }
          return claim;
        }),
      );
    },

    recordEvent(event, meta) {
      guard("record event", () => {
        events.insert(event, meta);
      });
    },

    loadSession(adapterId, sessionId) {
      return guard("load session", () => sessions.get(adapterId, sessionId));
    },

    saveSession(session) {
      guard("save session", () => {
        sessions.upsert(session);
      });
    },

    recordDiagnostic(issue) {
      // The PRD defines no diagnostics table; keep a bounded in-memory trail
      // for doctor/status without adding a competing persistence contract.
      diagnostics.push(issue);
      if (diagnostics.length > MAX_DIAGNOSTICS) {
        diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
      }
    },

    recordDelivery(delivery) {
      guard("record delivery", () => {
        deliveries.upsert(delivery);
      });
    },

    listSessions() {
      return guard("list sessions", () => sessions.list());
    },

    listEvents(filters) {
      return guard("list events", () => events.list(filters));
    },

    listDeliveries(eventId) {
      return guard("list deliveries", () => deliveries.list(eventId));
    },

    openRequests() {
      return guard("list open requests", () => requests.listOpen());
    },

    purgeExpired(now) {
      const normalizedNow = normalizeTimestamp(now, "now");
      const cutoff = cutoffBefore(normalizedNow, options.retentionDays);

      return guard("purge expired records", () =>
        db.transaction(() => {
          const deliveryCount = deliveries.purgeAttemptedBefore(cutoff);
          const eventCount = events.purgeReceivedBefore(cutoff);
          const requestCount = requests.purgeResolvedBefore(cutoff);
          const sessionCount = sessions.purgeTerminalBefore(cutoff);
          const dedupeCount = dedupe.purgeExpired(normalizedNow);

          return {
            dedupeRecords: dedupeCount,
            events: eventCount,
            deliveries: deliveryCount,
            sessions: sessionCount,
            requests: requestCount,
          };
        }),
      );
    },

    close() {
      db.close();
    },
  };
}
