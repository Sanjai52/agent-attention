/**
 * Event-processing pipeline (PRD.md §14.2).
 *
 * Order, and why:
 * 1. Validate and reject safely (never throw to the host).
 * 2. Check the adapter capability declaration before claiming anything.
 * 3. Claim the dedupe fingerprint, then record the event, then mutate state.
 * 4. Order-check late events; only a request-closing event may still apply.
 * 5. Apply the pure state transition.
 * 6. Resolve policy and apply suppressors in PRD order.
 * 7. Plan notifications and timer instructions. Never execute a timer.
 *
 * The pipeline is deterministic and side-effect free apart from the injected
 * store, clock, rate limiter, and the explicit grace map.
 *
 * Focus awareness (F13) is intentionally absent: Q-06 is still open, so the
 * pipeline must not invent a foreground-window check. Phase 2 adds it as a
 * suppressor between quiet hours and turn-end precedence when the decision
 * lands (PRD §14.2 step 6).
 */

import {
  parseAgentEvent,
  type AdapterCapabilities,
  type AgentAttentionConfig,
  type AgentEvent,
  type AgentEventType,
} from "@agent-attention/contract";
import { AUDIO_PRIORITY } from "../attention/rate-limit";
import { planReminderTimers } from "../attention/reminders";
import { evaluateTurnEnd } from "../attention/turn-end";
import { computeFingerprints } from "../dedupe/fingerprint";
import { isLateEvent, isTrustworthyTime } from "../ordering";
import { quietHoursSuppressions } from "../policy/quiet-hours";
import { renderNotification } from "../presentation/templates";
import { applyEvent } from "../state/transitions";
import type { SessionRecord } from "../state/session";
import type {
  Channel,
  PipelineDependencies,
  PipelineDiagnostic,
  PlannedChannel,
  PlannedNotification,
  ProcessingResult,
  SuppressionReason,
  TimerInstruction,
} from "./types";

type PolicyEventClass = "needsInput" | "needsApproval" | "turnEnded" | "completed" | "failed";

const POLICY_CLASS: Readonly<Partial<Record<AgentEventType, PolicyEventClass>>> = Object.freeze({
  "agent.needs_input": "needsInput",
  "agent.needs_approval": "needsApproval",
  "agent.turn_ended": "turnEnded",
  "agent.completed": "completed",
  "agent.failed": "failed",
});

const CLASSIFIED_EVENTS: ReadonlySet<AgentEventType> = new Set<AgentEventType>([
  "agent.needs_input",
  "agent.needs_approval",
  "agent.completed",
  "agent.failed",
]);

interface ChannelDecision {
  decision: "dispatch" | "suppress";
  reason?: SuppressionReason;
}

type ChannelMap = Record<Channel, ChannelDecision>;

function sessionKeyOf(event: AgentEvent): string {
  return `${event.source.adapterId}:${event.session.sessionId}`;
}

function initialChannels(): ChannelMap {
  return {
    sound: { decision: "dispatch" },
    voice: { decision: "dispatch" },
    desktop: { decision: "dispatch" },
  };
}

function suppressChannel(
  channels: ChannelMap,
  channel: Channel,
  reason: SuppressionReason,
): void {
  if (channels[channel].decision === "dispatch") {
    channels[channel] = { decision: "suppress", reason };
  }
}

function suppressAll(channels: ChannelMap, reason: SuppressionReason): void {
  suppressChannel(channels, "sound", reason);
  suppressChannel(channels, "voice", reason);
  suppressChannel(channels, "desktop", reason);
}

function anyDispatch(channels: ChannelMap): boolean {
  return (Object.values(channels) as ChannelDecision[]).some(
    (decision) => decision.decision === "dispatch",
  );
}

function capabilityViolation(
  event: AgentEvent,
  capabilities: AdapterCapabilities | undefined,
): string | undefined {
  if (capabilities === undefined) {
    return undefined;
  }

  const capability = capabilities.events[event.eventType];
  if (capability === undefined || capability.support === "unsupported") {
    return `${event.eventType} is not supported by adapter ${capabilities.adapterId}`;
  }

  if (event.eventType === "agent.turn_ended" && event.confidence === "authoritative") {
    return "agent.turn_ended must be inferred, not authoritative";
  }

  if (capability.support === "inferred" && event.confidence === "authoritative") {
    return `${event.eventType} is declared inferred but was received as authoritative`;
  }

  return undefined;
}

function closesOpenRequest(session: SessionRecord, event: AgentEvent): boolean {
  if (
    event.eventType !== "agent.approval_resolved" &&
    event.eventType !== "agent.resumed"
  ) {
    return false;
  }

  const requestId = event.details?.requestId;
  return (
    requestId !== undefined &&
    session.pendingRequests.some((request) => request.requestId === requestId)
  );
}

/**
 * Event time for ordering and quiet hours: source time only when the adapter
 * proved it is not a copy of receipt time (PRD §13.4, F8-R5).
 */
function eventTimeOf(event: AgentEvent): string {
  return isTrustworthyTime(event) ? event.occurredAt : event.receivedAt;
}

function isOlderThanSession(session: SessionRecord, event: AgentEvent): boolean {
  if (event.sequence !== undefined && session.lastAcceptedSequence !== undefined) {
    return event.sequence < session.lastAcceptedSequence;
  }

  const eventMs = Date.parse(eventTimeOf(event));
  const lastMs = Date.parse(session.lastEventAt);
  return Number.isFinite(eventMs) && Number.isFinite(lastMs) && eventMs < lastMs;
}

function effectiveSubagent(session: SessionRecord, deps: PipelineDependencies): boolean {
  if (!session.isSubagent || session.parentSessionId === undefined) {
    return false;
  }
  return deps.store.loadSession(session.adapterId, session.parentSessionId) !== undefined;
}

function eventConfig(
  config: AgentAttentionConfig,
  eventType: AgentEventType,
): AgentAttentionConfig["events"][PolicyEventClass] | undefined {
  const key = POLICY_CLASS[eventType];
  return key === undefined ? undefined : config.events[key];
}

function notifyReasonForCancelled(
  event: AgentEvent,
  config: AgentAttentionConfig,
): boolean {
  return (
    event.eventType === "agent.failed" &&
    event.details?.failureCode === "cancelled" &&
    !config.events.failed.notifyOnCancelled
  );
}

function staleTimer(deps: PipelineDependencies, sessionKey: string): TimerInstruction {
  return {
    kind: "stale",
    dueAt: new Date(
      deps.clock.nowMs() + deps.config.stale.workingAfterMinutes * 60_000,
    ).toISOString(),
    sessionKey,
  };
}

/**
 * A classified event always wins over an inferred turn-end (F10-R3,
 * AC-F10-02). The host owns the grace timer and the pending turn-end plan; the
 * pipeline removes the entry and reports the conflict so Phase 2 can drop the
 * pending plan before it dispatches.
 */
function supersedeGrace(
  event: AgentEvent,
  deps: PipelineDependencies,
  sessionKey: string,
  diagnostics: PipelineDiagnostic[],
): void {
  if (!CLASSIFIED_EVENTS.has(event.eventType) || deps.grace === undefined) {
    return;
  }

  const pending = deps.grace.pending.get(sessionKey);
  if (pending === undefined) {
    return;
  }

  if (deps.clock.nowMs() >= Date.parse(pending.dueAt)) {
    // The grace timer already fired; the pending plan is no longer live.
    deps.grace.pending.delete(sessionKey);
    return;
  }

  deps.grace.pending.delete(sessionKey);
  const diagnostic: PipelineDiagnostic = {
    code: "state_conflict",
    message: `turn-end alert ${pending.eventId} superseded by ${event.eventId}`,
    sessionKey,
  };
  diagnostics.push(diagnostic);
  deps.store.recordDiagnostic(diagnostic);
}

function planNotification(
  event: AgentEvent,
  session: SessionRecord,
  transition: ReturnType<typeof applyEvent>,
  deps: PipelineDependencies,
  sessionKey: string,
  timers: TimerInstruction[],
): PlannedNotification[] {
  const cfgClass = eventConfig(deps.config, event.eventType);
  // State/history-only events and disabled classes plan no channels at all.
  if (cfgClass === undefined || !cfgClass.enabled) {
    return [];
  }

  const channels = initialChannels();

  // Policy resolution: a cancellation is not an alert by default (F9-R4).
  if (notifyReasonForCancelled(event, deps.config)) {
    suppressAll(channels, "disabled");
  }

  const isSubagent = effectiveSubagent(session, deps);
  if (
    isSubagent &&
    !deps.config.subagents.notify &&
    (event.eventType === "agent.completed" ||
      event.eventType === "agent.turn_ended" ||
      event.eventType === "agent.failed")
  ) {
    suppressAll(channels, "subagent");
  }

  if (event.eventType === "agent.turn_ended") {
    const turnEnd = evaluateTurnEnd({
      turnDurationMs: event.details?.turnDurationMs,
      minTurnSeconds: deps.config.events.turnEnded.minTurnSeconds,
      classifiedEventWithinGrace: false,
      isSubagent,
      notifySubagents: deps.config.subagents.notify,
    });
    if (turnEnd.decision === "suppress") {
      suppressAll(channels, turnEnd.reason ?? "disabled");
    }
  }

  // Per-event channel toggles and the global channel switches. "Disabled"
  // takes precedence over "muted" because no channel was configured.
  if (!cfgClass.sound.enabled || !deps.config.channels.sound) {
    suppressChannel(channels, "sound", "disabled");
  }
  if (!cfgClass.voice.enabled || !deps.config.channels.voice) {
    suppressChannel(channels, "voice", "disabled");
  }
  if (!cfgClass.desktop.enabled || !deps.config.channels.desktop) {
    suppressChannel(channels, "desktop", "disabled");
  }

  if (deps.config.globalMute) {
    suppressChannel(channels, "sound", "muted");
    suppressChannel(channels, "voice", "muted");
  }

  const quietClock = eventTimeOf(event);
  if (deps.config.quietHours.enabled) {
    const quiet = quietHoursSuppressions(
      deps.config,
      deps.quietHoursMinutes(quietClock),
    );
    if (quiet.sound) {
      suppressChannel(channels, "sound", "quiet_hours");
    }
    if (quiet.voice) {
      suppressChannel(channels, "voice", "quiet_hours");
    }
    if (quiet.desktop) {
      suppressChannel(channels, "desktop", "quiet_hours");
    }
  }

  let rateLimitedAudible: Array<"sound" | "voice"> = [];
  const audibleBeforeRateLimit =
    channels.sound.decision === "dispatch" || channels.voice.decision === "dispatch";
  if (audibleBeforeRateLimit) {
    const bypass =
      (event.eventType === "agent.needs_input" ||
        event.eventType === "agent.needs_approval") &&
      transition.openedRequest !== undefined;
    const admission = deps.rateLimiter.admit(event, deps.clock.nowMs(), { bypass });
    if (!admission.admitted) {
      const wasSound = channels.sound.decision === "dispatch";
      const wasVoice = channels.voice.decision === "dispatch";
      suppressChannel(channels, "sound", "rate_limit");
      suppressChannel(channels, "voice", "rate_limit");
      rateLimitedAudible = [
        ...(wasSound ? (["sound"] as const) : []),
        ...(wasVoice ? (["voice"] as const) : []),
      ];
    }
  }

  const timeLabel = deps.formatTimeLabel?.(quietClock) ?? quietClock.slice(11, 16);
  const render = (coalescedCount?: number) =>
    renderNotification({
      eventType: event.eventType,
      ...(event.details?.completionScope === undefined
        ? {}
        : { completionScope: event.details.completionScope }),
      agentName: event.source.agentName,
      ...(session.projectName === undefined ? {} : { projectName: session.projectName }),
      timeLabel,
      privacy: deps.config.privacy,
      ...(coalescedCount === undefined ? {} : { coalescedCount }),
    }) ?? undefined;

  const rendered = render();
  const plannedChannels: PlannedChannel[] = [
    { channel: "sound", ...channels.sound },
    { channel: "voice", ...channels.voice },
    { channel: "desktop", ...channels.desktop },
  ];

  const planned: PlannedNotification[] = [
    {
      eventId: event.eventId,
      eventType: event.eventType,
      priority: AUDIO_PRIORITY[event.eventType] ?? 0,
      channels: plannedChannels,
      ...(rendered === undefined ? {} : { rendered }),
    },
  ];

  // F12-R4: excess audible alerts are summarized in one coalesced plan. The
  // pipeline only sees this event, so the count starts at one; Phase 2 merges
  // same-window summaries when it drains the audio queue.
  if (rateLimitedAudible.length > 0) {
    const summaryRendered = render(1);
    const summaryChannels: PlannedChannel[] = (
      ["sound", "voice", "desktop"] as const
    ).map((channel): PlannedChannel => {
      if (channel === "desktop") {
        // The original plan keeps its desktop toast; the summary is audible.
        return { channel, decision: "suppress", reason: "coalesced" };
      }
      if (rateLimitedAudible.includes(channel)) {
        return { channel, decision: "dispatch" };
      }
      return { channel, ...channels[channel] };
    });

    planned.push({
      eventId: `${event.eventId}:coalesced`,
      eventType: event.eventType,
      priority: AUDIO_PRIORITY[event.eventType] ?? 0,
      channels: summaryChannels,
      ...(summaryRendered === undefined ? {} : { rendered: summaryRendered }),
    });
  }

  if (
    event.eventType === "agent.turn_ended" &&
    deps.grace !== undefined &&
    anyDispatch(channels)
  ) {
    const dueAt = new Date(deps.clock.nowMs() + deps.grace.graceMs).toISOString();
    deps.grace.pending.set(sessionKey, { eventId: event.eventId, dueAt });
    timers.push({ kind: "grace", dueAt, sessionKey });
  }

  return planned;
}

function planTimers(
  transition: ReturnType<typeof applyEvent>,
  deps: PipelineDependencies,
  now: string,
  sessionKey: string,
): TimerInstruction[] {
  const timers: TimerInstruction[] = [];

  if (transition.session.state === "working") {
    timers.push(staleTimer(deps, sessionKey));
  }

  if (transition.openedRequest !== undefined) {
    const reminder = planReminderTimers(transition.openedRequest, deps.config, now);
    if (reminder !== undefined) {
      timers.push({
        kind: "reminder",
        dueAt: reminder.dueAt,
        sessionKey,
        requestId: reminder.requestId,
      });
    }
  }

  return timers;
}

function processValidEvent(
  event: AgentEvent,
  deps: PipelineDependencies,
): ProcessingResult {
  const sessionKey = sessionKeyOf(event);

  const violation = capabilityViolation(event, deps.capabilities);
  if (violation !== undefined) {
    const diagnostic: PipelineDiagnostic = {
      code: "capability_violation",
      message: violation,
      sessionKey,
    };
    deps.store.recordDiagnostic(diagnostic);
    return {
      status: "rejected",
      planned: [],
      timers: [],
      diagnostics: [diagnostic],
    };
  }

  const now = deps.clock.now();
  const isProgress = event.eventType === "agent.progress";
  const fingerprints = computeFingerprints(
    event,
    deps.config.deduplication.fallbackWindowSeconds,
  );

  if (fingerprints === null && !isProgress) {
    const diagnostic: PipelineDiagnostic = {
      code: "internal",
      message: `could not compute a fingerprint for ${event.eventId}`,
      sessionKey,
    };
    deps.store.recordDiagnostic(diagnostic);
    return {
      status: "rejected",
      planned: [],
      timers: [],
      diagnostics: [diagnostic],
    };
  }

  // Read-only session lookup so lateness is known before the atomic claim. The
  // claim itself still precedes every persistence and state mutation.
  let session = deps.store.loadSession(
    event.source.adapterId,
    event.session.sessionId,
  );

  // Progress is liveness, not a state-changing event (PRD §14.4); an older
  // heartbeat still updates `lastSeenAt`.
  const isClosing =
    !isProgress && session !== undefined && closesOpenRequest(session, event);
  const late =
    !isProgress &&
    session !== undefined &&
    (isLateEvent(event, undefined, session) || isOlderThanSession(session, event));

  let eventRecorded = false;
  // Claim before any persistence or state mutation (PRD §14.2 step 2). The
  // concrete store can claim and insert in one transaction; a store that only
  // exposes claimFingerprint keeps the two-call fallback.
  if (fingerprints !== null) {
    if (deps.store.claimEvent !== undefined) {
      const claim = deps.store.claimEvent(event, fingerprints, { late }, now);
      if (!claim.claimed) {
        return {
          status: "duplicate",
          planned: [],
          timers: [],
          diagnostics: [],
        };
      }
      eventRecorded = true;
    } else {
      const primary = deps.store.claimFingerprint(
        fingerprints.primary,
        event.eventId,
        now,
      );
      if (!primary.claimed) {
        return {
          status: "duplicate",
          planned: [],
          timers: [],
          diagnostics: [],
        };
      }

      if (fingerprints.adjacent !== undefined) {
        const adjacent = deps.store.claimFingerprint(
          fingerprints.adjacent,
          event.eventId,
          now,
        );
        if (!adjacent.claimed) {
          return {
            status: "duplicate",
            planned: [],
            timers: [],
            diagnostics: [],
          };
        }
      }
    }
  }

  if (late) {
    if (!eventRecorded && fingerprints !== null) {
      deps.store.recordEvent(event, {
        fingerprint: fingerprints.primary,
        late: true,
        duplicate: false,
      });
    }

    // A resolution that closes an open request is applied even when late
    // (PRD §13.4), but it never notifies.
    if (isClosing && session !== undefined) {
      const transition = applyEvent(session, event, now, deps.capabilities);
      deps.store.saveSession(transition.session);
      session = transition.session;
      const timers =
        session.state === "working" ? [staleTimer(deps, sessionKey)] : [];
      return {
        status: "late",
        planned: [],
        timers,
        diagnostics: [],
        session,
      };
    }

    return {
      status: "late",
      planned: [],
      timers: [],
      diagnostics: [],
      ...(session === undefined ? {} : { session }),
    };
  }

  if (!eventRecorded && fingerprints !== null) {
    deps.store.recordEvent(event, {
      fingerprint: fingerprints.primary,
      late: false,
      duplicate: false,
    });
  }

  const transition = applyEvent(session, event, now, deps.capabilities);
  deps.store.saveSession(transition.session);
  session = transition.session;

  const diagnostics: PipelineDiagnostic[] = [];
  supersedeGrace(event, deps, sessionKey, diagnostics);

  const timers = planTimers(transition, deps, now, sessionKey);
  const planned = planNotification(event, session, transition, deps, sessionKey, timers);

  return {
    status: "processed",
    planned,
    timers,
    diagnostics,
    session,
  };
}

/**
 * Validate and process one event. Never throws: malformed input, a failed
 * capability check, or an unexpected internal error becomes a rejected result
 * with diagnostics (PRD §12.3, §14.2 step 1).
 */
export function processEvent(
  input: unknown,
  deps: PipelineDependencies,
): ProcessingResult {
  try {
    const parsed = parseAgentEvent(input);
    if (!parsed.ok) {
      const diagnostics: PipelineDiagnostic[] = parsed.errors.map((issue) => ({
        code: "validation",
        message: `${issue.path}: ${issue.message}`,
      }));
      for (const issue of parsed.errors) {
        deps.store.recordDiagnostic(issue);
      }
      return { status: "rejected", planned: [], timers: [], diagnostics };
    }

    return processValidEvent(parsed.event, deps);
  } catch (error) {
    const diagnostic: PipelineDiagnostic = {
      code: "internal",
      message: error instanceof Error ? error.message : "internal pipeline error",
    };
    try {
      deps.store.recordDiagnostic(diagnostic);
    } catch {
      // A broken store must not turn an internal error into a host crash.
    }
    return { status: "rejected", planned: [], timers: [], diagnostics: [diagnostic] };
  }
}
