/**
 * Delivery outcomes (PRD.md §14.2 step 8, §15.1).
 *
 * One row per event/channel holds the latest outcome. `suppressed` carries the
 * suppressor reason; `failed`/`unavailable` carry a provider error code.
 */

import type { Channel } from "@agent-attention/core";
import type { AgentAttentionDb } from "../db";
import { validateTimestamp } from "../time";

export type DeliveryStatus = "delivered" | "failed" | "unavailable" | "suppressed";

export interface DeliveryRecord {
  eventId: string;
  channel: Channel;
  status: DeliveryStatus;
  reason?: string;
  errorCode?: string;
  attemptedAt: string;
}

export interface DeliveryRepository {
  upsert(delivery: DeliveryRecord): void;
  list(eventId: string): DeliveryRecord[];
  purgeAttemptedBefore(cutoff: string): number;
}

interface DeliveryRow {
  event_id: string;
  channel: string;
  status: string;
  reason: string | null;
  error_code: string | null;
  attempted_at: string;
}

export function createDeliveryRepository(db: AgentAttentionDb): DeliveryRepository {
  const upsert = db.raw.prepare(`
    INSERT INTO event_deliveries (event_id, channel, status, reason, error_code, attempted_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (event_id, channel) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      error_code = excluded.error_code,
      attempted_at = excluded.attempted_at
  `);
  const list = db.raw.prepare(
    "SELECT event_id, channel, status, reason, error_code, attempted_at FROM event_deliveries WHERE event_id = ? ORDER BY attempted_at ASC, channel ASC",
  );
  const purge = db.raw.prepare(
    "DELETE FROM event_deliveries WHERE julianday(attempted_at) < julianday(?)",
  );

  return {
    upsert(delivery) {
      upsert.run(
        delivery.eventId,
        delivery.channel,
        delivery.status,
        delivery.reason ?? null,
        delivery.errorCode ?? null,
        validateTimestamp(delivery.attemptedAt, "delivery.attemptedAt"),
      );
    },

    list(eventId) {
      const rows = list.all(eventId) as unknown as DeliveryRow[];
      return rows.map((row) => ({
        eventId: row.event_id,
        channel: row.channel as Channel,
        status: row.status as DeliveryStatus,
        ...(row.reason === null ? {} : { reason: row.reason }),
        ...(row.error_code === null ? {} : { errorCode: row.error_code }),
        attemptedAt: row.attempted_at,
      }));
    },

    purgeAttemptedBefore(cutoff) {
      return Number(purge.run(validateTimestamp(cutoff, "cutoff")).changes);
    },
  };
}
