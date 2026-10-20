/**
 * Audible alert priority and rolling rate limiting (PRD.md F12-R1, F12-R4,
 * F12-R5; D-10).
 *
 * The limiter governs *audible* alerts only. History and desktop toasts are
 * never rate limited (F12-R2, F12-R4): the caller records every event and
 * applies `admitted === false` as `suppressed:rate_limit`.
 *
 * Time is injected (`nowMs`) so the core stays pure and deterministic; the
 * host owns the clock.
 */

import type { AgentEvent, AgentEventType } from "@agent-attention/contract";

/** The audible window is one rolling minute (F12-R4). */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Minimum quiet period between bypasses for one event class (F12-R5).
 *
 * The PRD calls this "after a quiet period" without pinning a value; the plan
 * fixes it at 30 seconds.
 */
export const BYPASS_QUIET_PERIOD_MS = 30_000;

/**
 * PRD D-10 audio priority: `needs_approval` > `needs_input` > `failed` >
 * `turn_ended` > `completed`. Higher numbers play first.
 *
 * Only the five alert classes are present. State/history-only events have no
 * audio priority and are not audible at all (PRD §14.1), so callers must treat
 * a missing entry as "not eligible for audio" rather than a default priority.
 */
export const AUDIO_PRIORITY: Readonly<Partial<Record<AgentEventType, number>>> = Object.freeze({
  "agent.needs_approval": 5,
  "agent.needs_input": 4,
  "agent.failed": 3,
  "agent.turn_ended": 2,
  "agent.completed": 1,
});

export interface RateLimitDecision {
  admitted: boolean;
  reason?: "rate_limit";
}

export interface AdmitOptions {
  /**
   * Set by the pipeline when this event opens a new `requestId` for input or
   * approval. The limiter still verifies the class and quiet period.
   */
  bypass: boolean;
}

/** Event classes eligible for the F12-R5 bypass. */
function isBypassableClass(eventType: AgentEventType): boolean {
  return eventType === "agent.needs_input" || eventType === "agent.needs_approval";
}

/**
 * Sliding-window audible rate limiter (F12-R4, F12-R5).
 *
 * - Normal admission requires fewer than `maxAlertsPerMinute` audible alerts
 *   in the preceding 60 seconds.
 * - A bypass admission is allowed for a new input/approval `requestId` when no
 *   alert of that class was admitted in the preceding 30 seconds. Per the
 *   PRD's F12-R5 exception, it may admit even when the window is full, and it
 *   is itself recorded as an audible alert.
 * - The quiet period is tracked per event class, not per session: two sessions
 *   do not each get an independent bypass supply.
 *
 * One instance is shared across sessions because the limit is global.
 */
export class RollingRateLimiter {
  readonly #maxAlertsPerMinute: number;
  #admittedAtMs: number[] = [];
  readonly #lastAdmittedByClass = new Map<AgentEventType, number>();

  constructor(maxAlertsPerMinute: number) {
    this.#maxAlertsPerMinute = Number.isFinite(maxAlertsPerMinute)
      ? Math.max(0, Math.floor(maxAlertsPerMinute))
      : 0;
  }

  admit(event: AgentEvent, nowMs: number, opts: AdmitOptions): RateLimitDecision {
    this.#prune(nowMs);

    if (opts.bypass && this.#canBypass(event, nowMs)) {
      this.#record(event.eventType, nowMs);
      return { admitted: true };
    }

    if (this.#admittedAtMs.length >= this.#maxAlertsPerMinute) {
      return { admitted: false, reason: "rate_limit" };
    }

    this.#record(event.eventType, nowMs);
    return { admitted: true };
  }

  #canBypass(event: AgentEvent, nowMs: number): boolean {
    if (!isBypassableClass(event.eventType)) {
      return false;
    }
    if (event.details?.requestId === undefined) {
      return false;
    }

    const lastAdmittedAt = this.#lastAdmittedByClass.get(event.eventType);
    return lastAdmittedAt === undefined || nowMs - lastAdmittedAt >= BYPASS_QUIET_PERIOD_MS;
  }

  #record(eventType: AgentEventType, nowMs: number): void {
    this.#admittedAtMs.push(nowMs);

    const lastAdmittedAt = this.#lastAdmittedByClass.get(eventType);
    if (lastAdmittedAt === undefined || nowMs > lastAdmittedAt) {
      this.#lastAdmittedByClass.set(eventType, nowMs);
    }
  }

  /** Drop admissions that fell out of the half-open `(now - 60 s, now]` window. */
  #prune(nowMs: number): void {
    this.#admittedAtMs = this.#admittedAtMs.filter(
      (admittedAt) => nowMs - admittedAt < RATE_LIMIT_WINDOW_MS,
    );
  }
}
