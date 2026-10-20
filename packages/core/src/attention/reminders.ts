/**
 * Reminder planning (PRD.md F14-R1–F14-R4, AC-F14-01, AC-F14-03).
 *
 * A reminder is a re-notification for a still-open `needs_input` /
 * `needs_approval` request. Planning only decides *whether and when* a timer
 * should exist; mute, quiet hours, focus, and F12 are applied later at
 * dispatch time (F14-R2).
 *
 * Cancellation (F14-R3) is expressed by the input: the pipeline removes closed
 * requests from `pendingRequests`, so a resolved, resumed, ended, or stale
 * request is passed as `undefined` and produces no timer.
 *
 * The function is pure. `now` is injected, and the arithmetic is ISO-time
 * based on `openedAt`; no wall clock is read.
 */

import type { AgentAttentionConfig } from "@agent-attention/contract";
import type { PendingRequest } from "../state/session";

/**
 * Marker consumed by the template layer (Task 1.11) so reminder rows use the
 * distinct "still waiting" wording rather than a duplicate original event
 * (F14-R2, F14-R4).
 */
export const reminderTextKind = "reminder";

export interface ReminderTimer {
  requestId: string;
  kind: "input" | "approval";
  dueAt: string;
}

function parseTime(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Plan the reminder timer for one pending request.
 *
 * Returns `undefined` when:
 * - the request is no longer open (`undefined` input);
 * - reminders are disabled (AC-F14-03);
 * - `remindersSent` already reached `reminders.maxReminders` (AC-F14-01);
 * - the timestamp cannot be parsed;
 * - the due time is not strictly after `now`.
 *
 * The last rule means a timer is planned only while it is still in the future.
 * A pipeline that re-evaluates exactly at (or after) the due time should
 * deliver the already-due reminder from the timer it previously scheduled
 * rather than expect a new plan.
 */
export function planReminderTimers(
  request: PendingRequest | undefined,
  config: AgentAttentionConfig,
  now: string,
): ReminderTimer | undefined {
  if (request === undefined || !config.reminders.enabled) {
    return undefined;
  }

  if (request.remindersSent >= config.reminders.maxReminders) {
    return undefined;
  }

  const openedAtMs = parseTime(request.openedAt);
  const nowMs = parseTime(now);
  if (openedAtMs === undefined || nowMs === undefined) {
    return undefined;
  }

  const dueAtMs = openedAtMs + config.reminders.afterMinutes * 60_000;
  if (dueAtMs <= nowMs) {
    return undefined;
  }

  return {
    requestId: request.requestId,
    kind: request.kind,
    dueAt: new Date(dueAtMs).toISOString(),
  };
}
