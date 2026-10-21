/** Timestamp helpers shared by repositories. Storage compares ISO-8601 UTC text. */

import { StorageError } from "./errors";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse and canonicalize an ISO timestamp; invalid input is a typed error. */
export function normalizeTimestamp(value: string, field: string): string {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new StorageError("invalid_input", `${field} must be an ISO 8601 timestamp`);
  }
  return new Date(millis).toISOString();
}

export function timestampMs(value: string, field: string): number {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new StorageError("invalid_input", `${field} must be an ISO 8601 timestamp`);
  }
  return millis;
}

/** Validate without rewriting, so stored records round-trip byte for byte. */
export function validateTimestamp(value: string, field: string): string {
  timestampMs(value, field);
  return value;
}

export function cutoffBefore(now: string, retentionDays: number): string {
  const nowMs = timestampMs(now, "now");
  return new Date(nowMs - retentionDays * DAY_MS).toISOString();
}
