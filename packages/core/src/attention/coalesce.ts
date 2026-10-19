/**
 * Alert coalescing planning (PRD.md F12-R3).
 *
 * Coalescing is a *planning* step: the core groups eligible alerts of the same
 * class whose timestamps fall inside one window. It never removes events from
 * the caller's history (F12-R3: "History retains every event"); the caller
 * keeps recording each event and uses the plan only for sound/voice/desktop
 * output.
 *
 * Groups are anchored at their first alert: alerts join while they fall within
 * `windowSeconds` of the group's `firstAt`. Anchoring bounds how long a stream
 * of alerts can keep a group open, unlike a sliding "within the window of the
 * previous alert" rule.
 *
 * Time is provided on each alert as an ISO timestamp; the function is pure and
 * deterministic.
 */

import type { AgentEventType } from "@agent-attention/contract";

/**
 * One alert that reached the coalescing suppressor.
 *
 * `sessionKey` is carried for attribution but does not split groups: F12-R3
 * merges by event class, so several sessions needing input coalesce into one
 * summary. The field is accepted so the pipeline can pass its eligible-alert
 * records unchanged.
 */
export interface EligibleAlert {
  eventClass: AgentEventType;
  at: string;
  sessionKey?: string;
}

export interface CoalescedGroup {
  eventClass: AgentEventType;
  count: number;
  firstAt: string;
  lastAt: string;
}

export interface CoalescedPlan {
  groups: CoalescedGroup[];
  /** True when at least one group summarizes more than one alert (F12-R4). */
  summaryRequired: boolean;
}

interface GroupAccumulator {
  group: CoalescedGroup;
  /** Parsed `firstAt`; `NaN` means the group can never be extended. */
  firstAtMs: number;
}

function parseAt(value: string): number {
  return Date.parse(value);
}

/**
 * Group eligible alerts by event class and time window.
 *
 * Input is not mutated: a copy is sorted by timestamp so out-of-order history
 * still produces chronological groups and `firstAt`/`lastAt` are meaningful.
 * `lastAt` is the latest alert admitted to the group, which is not necessarily
 * the last element in caller order.
 */
export function planCoalescing(alerts: EligibleAlert[], windowSeconds: number): CoalescedPlan {
  const windowMs = Number.isFinite(windowSeconds)
    ? Math.max(0, windowSeconds) * 1_000
    : Number.POSITIVE_INFINITY;

  const ordered = [...alerts].sort((a, b) => {
    const aMs = parseAt(a.at);
    const bMs = parseAt(b.at);
    if (Number.isNaN(aMs) && Number.isNaN(bMs)) {
      return 0;
    }
    if (Number.isNaN(aMs)) {
      return 1;
    }
    if (Number.isNaN(bMs)) {
      return -1;
    }
    return aMs - bMs;
  });

  const groups: CoalescedPlan["groups"] = [];
  const openByClass = new Map<AgentEventType, GroupAccumulator>();

  for (const alert of ordered) {
    const atMs = parseAt(alert.at);
    const open = openByClass.get(alert.eventClass);

    if (
      open !== undefined &&
      !Number.isNaN(atMs) &&
      !Number.isNaN(open.firstAtMs) &&
      atMs - open.firstAtMs <= windowMs
    ) {
      open.group.count += 1;
      open.group.lastAt = atMs > parseAt(open.group.lastAt) ? alert.at : open.group.lastAt;
      continue;
    }

    const group: CoalescedGroup = {
      eventClass: alert.eventClass,
      count: 1,
      firstAt: alert.at,
      lastAt: alert.at,
    };
    groups.push(group);
    openByClass.set(alert.eventClass, { group, firstAtMs: atMs });
  }

  return {
    groups,
    summaryRequired: groups.some((group) => group.count > 1),
  };
}
