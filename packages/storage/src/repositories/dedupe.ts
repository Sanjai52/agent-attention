/**
 * Dedupe records (PRD.md §14.4, §15.1).
 *
 * The fingerprint is the primary key, so "claim once" is enforced by SQLite
 * rather than by process memory. A duplicate increments `duplicate_count` and
 * refreshes `expires_at` without touching the event row.
 */

import type { AgentAttentionDb } from "../db";
import { DAY_MS, normalizeTimestamp, validateTimestamp } from "../time";

/** PRD §14.4: records persist for max(fallbackWindowSeconds, 24 h). */
export const DEDUPE_RETENTION_MS = DAY_MS;

export interface ClaimFingerprintResult {
  claimed: boolean;
  duplicateCount?: number;
}

export interface DedupeRepository {
  claim(fingerprint: string, eventId: string, now: string): ClaimFingerprintResult;
  purgeExpired(now: string): number;
}

interface CountRow {
  duplicate_count: number | bigint;
}

export function createDedupeRepository(db: AgentAttentionDb): DedupeRepository {
  const insert = db.raw.prepare(`
    INSERT INTO dedupe_records (
      fingerprint, event_id, first_seen_at, expires_at, duplicate_count
    ) VALUES (?, ?, ?, ?, 0)
    ON CONFLICT (fingerprint) DO NOTHING
  `);
  const bump = db.raw.prepare(`
    UPDATE dedupe_records
       SET duplicate_count = duplicate_count + 1,
           expires_at = CASE WHEN expires_at > ? THEN expires_at ELSE ? END
     WHERE fingerprint = ?
  `);
  const selectCount = db.raw.prepare(
    "SELECT duplicate_count FROM dedupe_records WHERE fingerprint = ?",
  );
  const purge = db.raw.prepare(
    "DELETE FROM dedupe_records WHERE julianday(expires_at) <= julianday(?)",
  );

  return {
    claim(fingerprint, eventId, now) {
      const firstSeenAt = validateTimestamp(now, "now");
      const expiresAt = new Date(Date.parse(firstSeenAt) + DEDUPE_RETENTION_MS).toISOString();

      return db.transaction(() => {
        const inserted = insert.run(fingerprint, eventId, firstSeenAt, expiresAt);
        if (inserted.changes > 0) {
          return { claimed: true };
        }

        bump.run(expiresAt, expiresAt, fingerprint);
        const row = selectCount.get(fingerprint) as CountRow | undefined;
        return {
          claimed: false,
          duplicateCount: Number(row?.duplicate_count ?? 0),
        };
      });
    },

    purgeExpired(now) {
      const normalized = normalizeTimestamp(now, "now");
      return Number(purge.run(normalized).changes);
    },
  };
}
