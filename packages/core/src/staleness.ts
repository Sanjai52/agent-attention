/**
 * Staleness evaluation and host-restart reconciliation (PRD.md F7-R4, §13.4,
 * AC-P).
 *
 * A session is only shown as `working` while it has recent verifiable
 * activity. Activity is the newest of `lastSeenAt` (receiver time, updated by
 * every accepted event including progress heartbeats), `lastEventAt`
 * (trustworthy event time), and `lastVerifiedAt` (last authoritative event).
 * The function never reads a clock: `now` is injected.
 *
 * Boundary rule: the timeout is inclusive. A session that has been silent for
 * exactly `workingAfterMinutes` or `waitingAfterHours` is stale.
 *
 * `evaluateStaleness` reports the decisions; it does not mutate the session.
 * The returned `closedRequests` are copies for the pipeline to close with
 * resolution `unknown` (F14-R3: staleness cancels reminders).
 *
 * `reconcileAfterHostRestart` is deliberately stricter than time-based
 * staleness: PRD §13.4 says the core MUST NOT assume a prior `working` state is
 * still true after a host restart, so every `working` session is demoted
 * unconditionally, even if its last activity is recent. Waiting/idle sessions
 * keep their state here and are left to the normal staleness rules; terminal
 * states are never touched.
 */

import type {
  PendingRequest,
  SessionRecord,
  SessionState,
  SessionStateConfidence,
} from "./state/session";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface StalenessConfig {
  workingAfterMinutes: number;
  waitingAfterHours: number;
}

export interface StalenessResult {
  state: SessionState;
  stateConfidence: SessionStateConfidence;
  /** Open requests that staleness closes with resolution `unknown`. */
  closedRequests: PendingRequest[];
}

function cloneRequests(requests: PendingRequest[]): PendingRequest[] {
  return requests.map((request) => ({ ...request }));
}

function parseTime(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Newest parseable activity timestamp, or `undefined` when none is usable. */
function latestActivityMs(session: SessionRecord): number | undefined {
  const candidates = [session.lastSeenAt, session.lastEventAt, session.lastVerifiedAt]
    .map(parseTime)
    .filter((value): value is number => value !== undefined);

  if (candidates.length === 0) {
    return undefined;
  }

  return Math.max(...candidates);
}

function staleResult(session: SessionRecord): StalenessResult {
  return {
    state: "unknown",
    stateConfidence: "unverified",
    closedRequests: cloneRequests(session.pendingRequests),
  };
}

function isTerminal(state: SessionState): boolean {
  return state === "completed" || state === "failed" || state === "ended";
}

/**
 * Evaluate whether a session has gone stale (PRD §13.4, AC-F7-04).
 *
 * Returns `undefined` when the session should keep its current state:
 * terminal states, an already-`unknown` session, a session inside its window,
 * or an unparseable `now` (the caller must not guess without a clock).
 *
 * Non-terminal sessions with no parseable activity timestamp are treated as
 * stale: without verifiable activity the state cannot be shown as current.
 * Open requests are included in `closedRequests` for every stale transition so
 * that staleness cancels reminders (F14-R3); PRD §13.4 calls this out
 * explicitly for `waiting_*`, and the same reasoning applies to an inconsistent
 * `working` session that still has requests.
 */
export function evaluateStaleness(
  session: SessionRecord,
  now: string,
  config: StalenessConfig,
): StalenessResult | undefined {
  if (isTerminal(session.state) || session.state === "unknown") {
    return undefined;
  }

  const nowMs = parseTime(now);
  if (nowMs === undefined) {
    return undefined;
  }

  const timeoutMs =
    session.state === "working"
      ? Math.max(0, config.workingAfterMinutes) * MINUTE_MS
      : Math.max(0, config.waitingAfterHours) * HOUR_MS;

  const activityMs = latestActivityMs(session);
  if (activityMs === undefined) {
    return staleResult(session);
  }

  // A future activity timestamp (clock skew) yields a negative age and stays
  // fresh rather than becoming stale.
  return nowMs - activityMs >= timeoutMs ? staleResult(session) : undefined;
}

function cloneSession(session: SessionRecord): SessionRecord {
  return {
    ...session,
    pendingRequests: cloneRequests(session.pendingRequests),
    tasks: session.tasks.map((task) => ({ ...task })),
  };
}

/**
 * Project a session forward after a Notification Host restart (PRD §13.4).
 *
 * Every `working` session becomes `unknown`/`unverified`, regardless of
 * `now`, because a previously observed `working` state cannot be assumed to
 * still hold. The `now` argument is accepted for interface symmetry and future
 * recency checks; it is intentionally not used for that demotion.
 *
 * Waiting, idle, and terminal states are returned unchanged. Pending requests
 * are preserved: reconciliation has no closure channel, and waiting requests
 * may still be valid.
 */
export function reconcileAfterHostRestart(session: SessionRecord, _now: string): SessionRecord {
  const reconciled = cloneSession(session);

  if (reconciled.state === "working") {
    reconciled.state = "unknown";
    reconciled.stateConfidence = "unverified";
  }

  return reconciled;
}
