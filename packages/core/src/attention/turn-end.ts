/**
 * Turn-end precedence and minimum duration (PRD.md F10-R3, F10-R5, F10-R6).
 *
 * The host owns grace-window mechanics (Phase 2); the core decides from the
 * boolean `classifiedEventWithinGrace`. The decision order below is
 * deliberate and observable through the returned reason:
 *
 * 1. **Grace supersession.** A classified event for the same turn always wins
 *    over the inferred `turn_ended` alert (F10-R3, AC-F10-02), even when the
 *    turn was short or belongs to a subagent.
 * 2. **Subagent suppression.** Subagent turn-ends never notify unless
 *    `notifySubagents` is enabled (F10-R6). This is reported before duration so
 *    that callers can attribute the suppression to the subagent policy.
 * 3. **Minimum turn duration.** A known duration shorter than
 *    `minTurnSeconds` suppresses the alert (F10-R5, AC-F10-03); the event is
 *    still recorded by the pipeline.
 *
 * An unknown duration alerts: the core cannot prove that the turn was short.
 * The comparison is strict, so a turn exactly at the minimum alerts.
 */

export type TurnEndSuppressionReason = "below_min_turn" | "grace_superseded" | "subagent";

export interface TurnEndInput {
  turnDurationMs?: number;
  minTurnSeconds: number;
  classifiedEventWithinGrace: boolean;
  isSubagent: boolean;
  notifySubagents: boolean;
}

export interface TurnEndDecision {
  decision: "alert" | "suppress";
  reason?: TurnEndSuppressionReason;
}

export function evaluateTurnEnd(input: TurnEndInput): TurnEndDecision {
  if (input.classifiedEventWithinGrace) {
    return { decision: "suppress", reason: "grace_superseded" };
  }

  if (input.isSubagent && !input.notifySubagents) {
    return { decision: "suppress", reason: "subagent" };
  }

  if (input.turnDurationMs !== undefined && input.turnDurationMs < input.minTurnSeconds * 1000) {
    return { decision: "suppress", reason: "below_min_turn" };
  }

  return { decision: "alert" };
}
