/**
 * Enumerated summary codes (PRD.md §12.2).
 *
 * Summary codes are the only summary-like data allowed in an event; they
 * carry no free text from the agent (PRD §12.3).
 */

export const SUMMARY_CODES = Object.freeze([
  "INPUT_REQUIRED",
  "APPROVAL_REQUIRED",
  "TURN_ENDED",
  "TASK_COMPLETED",
  "SESSION_COMPLETED",
  "FAILED",
  "UNKNOWN",
] as const);

export type SummaryCode = (typeof SUMMARY_CODES)[number];
