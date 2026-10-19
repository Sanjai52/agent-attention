/**
 * Quiet-hours evaluation (PRD.md §8.3, §14.5, F8-R1–R2).
 *
 * Every input is wall-clock minutes of the local day (0–1439). Evaluation is
 * pure integer comparison: no `Date`, no duration math, and no timezone
 * conversion. DST safety therefore comes from the caller passing the local
 * wall-clock minute at the moment of the event; a nonexistent or ambiguous
 * local time is still just an integer and cannot throw.
 */

import type { AgentAttentionConfig } from "@agent-attention/contract";

export interface QuietHoursSuppressions {
  sound: boolean;
  voice: boolean;
  desktop: boolean;
}

/** Same shape as the configuration contract's clock regex (`HH:MM`, 24-hour). */
const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Parse `"HH:MM"` into minutes of day, or `undefined` when malformed. */
export function parseClockMinutes(value: string): number | undefined {
  if (!CLOCK_PATTERN.test(value)) {
    return undefined;
  }

  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3, 5));
  return hours * 60 + minutes;
}

/**
 * True when `minutesOfDay` falls in the half-open interval `[start, end)`.
 *
 * Ranges crossing midnight wrap: for 23:00–08:00, both 23:30 and 02:00 are
 * inside. `start === end` is an empty interval and never suppresses. All three
 * values are expected to be minutes of the local day (0–1439).
 */
export function isWithinQuietHours(
  minutesOfDay: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes === endMinutes) {
    return false;
  }

  if (startMinutes < endMinutes) {
    return minutesOfDay >= startMinutes && minutesOfDay < endMinutes;
  }

  return minutesOfDay >= startMinutes || minutesOfDay < endMinutes;
}

function noSuppressions(): QuietHoursSuppressions {
  return { sound: false, voice: false, desktop: false };
}

/**
 * Resolve the per-channel quiet-hours suppression flags for a wall-clock
 * minute of day (PRD F8-R2). Outside the window, when quiet hours are
 * disabled, or when the configured clock values are malformed, nothing is
 * suppressed. Malformed configuration fails open because it is already
 * reported by config validation; this pure helper must not throw.
 */
export function quietHoursSuppressions(
  config: AgentAttentionConfig,
  minutesOfDay: number,
): QuietHoursSuppressions {
  const quietHours = config.quietHours;

  if (!quietHours.enabled) {
    return noSuppressions();
  }

  const startMinutes = parseClockMinutes(quietHours.startTime);
  const endMinutes = parseClockMinutes(quietHours.endTime);
  if (startMinutes === undefined || endMinutes === undefined) {
    return noSuppressions();
  }

  if (!isWithinQuietHours(minutesOfDay, startMinutes, endMinutes)) {
    return noSuppressions();
  }

  return {
    sound: quietHours.suppressSound,
    voice: quietHours.suppressVoice,
    desktop: quietHours.suppressDesktop,
  };
}
