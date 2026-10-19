/**
 * Session state machine reducer (PRD.md §13.2, §13.3).
 *
 * `applyEvent` is pure: it never reads a clock, never performs I/O, and never
 * mutates its input. The caller supplies the receiver time (`now`) and gets a
 * fresh `SessionRecord` back.
 */

import type { AgentEvent, AgentEventType, CompletionScope } from "@agent-attention/contract";
import type {
  PendingRequest,
  SessionRecord,
  SessionState,
  SessionStateConfidence,
  TaskRecord,
  TaskState,
} from "./session";

export interface StateTransition {
  session: SessionRecord;
  /**
   * True when the event changed state, pending requests, or task records.
   * Liveness-only events (plain `progress`) and no-ops report `false`.
   */
  stateChanged: boolean;
  openedRequest?: PendingRequest;
  closedRequest?: PendingRequest;
  completionScope?: CompletionScope;
}

const DEFAULT_STATE: Record<AgentEventType, SessionState> = {
  "agent.started": "working",
  "agent.progress": "working",
  "agent.needs_input": "waiting_for_input",
  "agent.needs_approval": "waiting_for_approval",
  "agent.approval_resolved": "working",
  "agent.resumed": "working",
  "agent.turn_ended": "idle",
  "agent.completed": "completed",
  "agent.failed": "failed",
  "agent.session_ended": "ended",
  "agent.state_unknown": "unknown",
};

function eventTimestamp(event: AgentEvent): string {
  return event.occurredAt === event.receivedAt ? event.receivedAt : event.occurredAt;
}

function latestTimestamp(a: string, b: string): string {
  return Date.parse(b) >= Date.parse(a) ? b : a;
}

function mapConfidence(event: AgentEvent): SessionStateConfidence {
  return event.confidence;
}

function isTerminal(state: SessionState): boolean {
  return state === "completed" || state === "failed";
}

function newSession(event: AgentEvent, now: string): SessionRecord {
  const parentSessionId = event.session.parentSessionId;
  const state = DEFAULT_STATE[event.eventType];
  const confidence: SessionStateConfidence =
    event.eventType === "agent.started"
      ? mapConfidence(event)
      : event.eventType === "agent.state_unknown"
        ? "unverified"
        : "inferred";

  const session: SessionRecord = {
    adapterId: event.source.adapterId,
    sessionId: event.session.sessionId,
    agentName: event.source.agentName,
    state,
    stateConfidence: confidence,
    lastEventAt: eventTimestamp(event),
    lastSeenAt: now,
    lastVerifiedAt: undefined,
    pendingRequests: [],
    tasks: [],
    isSubagent: event.session.isSubagent === true && parentSessionId !== undefined,
  };

  if (parentSessionId !== undefined) {
    session.parentSessionId = parentSessionId;
  }
  if (event.session.projectName !== undefined) {
    session.projectName = event.session.projectName;
  }
  if (event.session.workingDirectory !== undefined) {
    session.workingDirectory = event.session.workingDirectory;
  }
  if (event.sequence !== undefined) {
    session.lastAcceptedSequence = event.sequence;
  }

  return session;
}

function cloneSession(session: SessionRecord): SessionRecord {
  return {
    ...session,
    pendingRequests: session.pendingRequests.map((request) => ({ ...request })),
    tasks: session.tasks.map((task) => ({ ...task })),
  };
}

function cloneRequests(requests: PendingRequest[]): PendingRequest[] {
  return requests.map((request) => ({ ...request }));
}

function sameRequests(a: PendingRequest[], b: PendingRequest[]): boolean {
  return (
    a.length === b.length &&
    a.every((request, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        request.kind === other.kind &&
        request.requestId === other.requestId &&
        request.openedAt === other.openedAt &&
        request.remindersSent === other.remindersSent
      );
    })
  );
}

function sameTasks(a: TaskRecord[], b: TaskRecord[]): boolean {
  return (
    a.length === b.length &&
    a.every((task, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        task.taskId === other.taskId &&
        task.state === other.state &&
        task.startedAt === other.startedAt &&
        task.endedAt === other.endedAt
      );
    })
  );
}

function takeRequests(
  requests: PendingRequest[],
  predicate: (request: PendingRequest) => boolean,
): { closed: PendingRequest[]; remaining: PendingRequest[] } {
  const closed: PendingRequest[] = [];
  const remaining: PendingRequest[] = [];

  for (const request of requests) {
    if (predicate(request)) {
      closed.push(request);
    } else {
      remaining.push(request);
    }
  }

  return { closed, remaining };
}

function closeAll(requests: PendingRequest[]): {
  closed: PendingRequest[];
  remaining: PendingRequest[];
} {
  return { closed: [...requests], remaining: [] };
}

function isClosingEventForOpenRequest(event: AgentEvent, requests: PendingRequest[]): boolean {
  if (event.eventType !== "agent.approval_resolved" && event.eventType !== "agent.resumed") {
    return false;
  }

  const requestId = event.details?.requestId;
  return requestId !== undefined && requests.some((request) => request.requestId === requestId);
}

function ensureTask(
  tasks: TaskRecord[],
  taskId: string,
  at: string,
  reactivate: boolean,
): TaskRecord[] {
  const index = tasks.findIndex((task) => task.taskId === taskId);

  if (index === -1) {
    return [...tasks, { taskId, state: "active", startedAt: at }];
  }

  const existing = tasks[index];
  if (existing === undefined || existing.state === "active" || !reactivate) {
    return tasks;
  }

  const updated: TaskRecord = { taskId, state: "active", startedAt: at };
  const next = [...tasks];
  next[index] = updated;
  return next;
}

function markTask(
  tasks: TaskRecord[],
  taskId: string,
  nextState: Exclude<TaskState, "active">,
  at: string,
): TaskRecord[] {
  const index = tasks.findIndex((task) => task.taskId === taskId);

  if (index === -1) {
    return [...tasks, { taskId, state: nextState, startedAt: at, endedAt: at }];
  }

  const existing = tasks[index];
  if (existing === undefined || existing.state === nextState) {
    return tasks;
  }

  // A failed task is not overwritten by a later completion for the same task
  // (and vice versa) unless started/resumed intervened (PRD §13.3).
  if (
    (existing.state === "failed" && nextState === "completed") ||
    (existing.state === "completed" && nextState === "failed")
  ) {
    return tasks;
  }

  const updated: TaskRecord = { ...existing, state: nextState, endedAt: at };
  const next = [...tasks];
  next[index] = updated;
  return next;
}

function eventTimeForTask(event: AgentEvent): string {
  return eventTimestamp(event);
}

/**
 * Applies one accepted event to a session (PRD §13.2).
 *
 * A late or duplicate sequence is ignored unless it closes an open request
 * (PRD §13.4: resolution events always close their request).
 */
export function applyEvent(
  session: SessionRecord | undefined,
  event: AgentEvent,
  now: string,
): StateTransition {
  const existing =
    session !== undefined &&
    session.adapterId === event.source.adapterId &&
    session.sessionId === event.session.sessionId
      ? session
      : undefined;
  const created = existing === undefined;
  const base = existing ?? newSession(event, now);
  const eventTime = eventTimestamp(event);

  const closesOpenRequest = isClosingEventForOpenRequest(event, base.pendingRequests);
  if (
    existing !== undefined &&
    event.sequence !== undefined &&
    existing.lastAcceptedSequence !== undefined &&
    event.sequence <= existing.lastAcceptedSequence &&
    !closesOpenRequest
  ) {
    return { session: cloneSession(existing), stateChanged: false };
  }

  let state = base.state;
  let confidence = base.stateConfidence;
  let pendingRequests = cloneRequests(base.pendingRequests);
  let tasks = base.tasks;
  let openedRequest: PendingRequest | undefined;
  let closedRequest: PendingRequest | undefined;
  let completionScope: CompletionScope | undefined;

  const closeRequests = (predicate: (request: PendingRequest) => boolean): void => {
    const result = takeRequests(pendingRequests, predicate);
    pendingRequests = result.remaining;
    if (closedRequest === undefined && result.closed.length > 0) {
      closedRequest = result.closed[0];
    }
  };

  const closeEveryRequest = (): void => {
    const result = closeAll(pendingRequests);
    pendingRequests = result.remaining;
    if (closedRequest === undefined && result.closed.length > 0) {
      closedRequest = result.closed[0];
    }
  };

  const ensureTaskForEvent = (reactivate: boolean): void => {
    const taskId = event.session.taskId;
    if (taskId !== undefined) {
      tasks = ensureTask(tasks, taskId, eventTimeForTask(event), reactivate);
    }
  };

  switch (event.eventType) {
    case "agent.started": {
      state = "working";
      confidence = mapConfidence(event);
      closeEveryRequest();
      ensureTaskForEvent(true);
      break;
    }

    case "agent.progress": {
      ensureTaskForEvent(false);

      if (state === "waiting_for_input") {
        state = "working";
        confidence = "inferred";
        closeRequests((request) => request.kind === "input");
      } else if (state === "idle" || state === "unknown") {
        state = "working";
        confidence = "inferred";
      }
      // waiting_for_approval, working, completed, failed, and ended keep their
      // state: progress is liveness, not an approval resolution or a revival.
      break;
    }

    case "agent.needs_input": {
      if (!isTerminal(state) && state !== "ended") {
        state = "waiting_for_input";
        confidence = mapConfidence(event);
        const requestId = event.details?.requestId ?? event.eventId;
        if (!pendingRequests.some((request) => request.requestId === requestId)) {
          const request: PendingRequest = {
            kind: "input",
            requestId,
            openedAt: now,
            remindersSent: 0,
          };
          pendingRequests = [...pendingRequests, request];
          openedRequest = request;
        }
        ensureTaskForEvent(false);
      }
      break;
    }

    case "agent.needs_approval": {
      if (!isTerminal(state) && state !== "ended") {
        state = "waiting_for_approval";
        confidence = mapConfidence(event);
        const requestId = event.details?.requestId ?? event.eventId;
        if (!pendingRequests.some((request) => request.requestId === requestId)) {
          const request: PendingRequest = {
            kind: "approval",
            requestId,
            openedAt: now,
            remindersSent: 0,
          };
          pendingRequests = [...pendingRequests, request];
          openedRequest = request;
        }
        ensureTaskForEvent(false);
      }
      break;
    }

    case "agent.approval_resolved": {
      const requestId = event.details?.requestId;
      closeRequests(
        (request) =>
          request.kind === "approval" &&
          (requestId === undefined || request.requestId === requestId),
      );

      if (state === "waiting_for_approval") {
        // Approved, denied, and unknown all close the request and return to
        // working. The next terminal event determines the outcome (§13.3).
        state = "working";
        confidence = mapConfidence(event);
      }
      ensureTaskForEvent(false);
      break;
    }

    case "agent.resumed": {
      const reason = event.details?.resumeReason ?? "unknown";
      const revivable =
        state === "working" ||
        state === "waiting_for_input" ||
        state === "idle" ||
        state === "unknown" ||
        ((state === "completed" || state === "failed" || state === "ended") &&
          reason === "new_prompt") ||
        (state === "waiting_for_approval" && reason === "new_prompt");

      if (revivable) {
        const requestId = event.details?.requestId;
        if (reason === "new_prompt") {
          closeEveryRequest();
        } else {
          closeRequests(
            (request) =>
              request.kind === "input" &&
              (requestId === undefined || request.requestId === requestId),
          );
        }

        state = "working";
        confidence = reason === "unknown" ? "inferred" : mapConfidence(event);
        ensureTaskForEvent(reason === "new_prompt");
      }
      break;
    }

    case "agent.turn_ended": {
      if (!isTerminal(state) && state !== "ended") {
        state = "idle";
        confidence = mapConfidence(event);
        closeEveryRequest();
        ensureTaskForEvent(false);
      }
      break;
    }

    case "agent.completed": {
      completionScope = event.details?.completionScope;
      const taskId = event.session.taskId;

      if (state === "failed") {
        // failed is never overwritten by completed for the same task/turn
        // without an intervening resumed/started (PRD §13.3).
        break;
      }

      if (state === "completed") {
        if (completionScope === "task" && taskId !== undefined) {
          tasks = markTask(tasks, taskId, "completed", eventTime);
        }
        break;
      }

      if (completionScope === "task") {
        if (taskId === undefined) {
          // No task identity: a task-scope completion can never complete the
          // session (interface resolution for Task 1.8).
          if (created) {
            state = "working";
            confidence = "inferred";
          }
          break;
        }

        tasks = markTask(tasks, taskId, "completed", eventTime);
        // Without a capability declaration, a host that supplies taskIds is
        // inferred to support task scope (interface resolution for Task 1.8).
        const supported = true;
        const hasActiveTasks = tasks.some((task) => task.state === "active");
        state = supported && !hasActiveTasks ? "completed" : "working";
        confidence = mapConfidence(event);
        closeEveryRequest();
        break;
      }

      state = "completed";
      confidence = mapConfidence(event);
      closeEveryRequest();
      break;
    }

    case "agent.failed": {
      if (state === "completed") {
        // completed is never overwritten by failed for the same task/turn
        // without an intervening resumed/started (PRD §13.3).
        break;
      }

      const taskId = event.session.taskId;
      if (taskId !== undefined) {
        tasks = markTask(tasks, taskId, "failed", eventTime);
      }
      state = "failed";
      confidence = mapConfidence(event);
      closeEveryRequest();
      break;
    }

    case "agent.session_ended": {
      state = "ended";
      confidence = mapConfidence(event);
      closeEveryRequest();
      break;
    }

    case "agent.state_unknown": {
      if (!isTerminal(state) && state !== "ended") {
        state = "unknown";
        confidence = "unverified";
        closeEveryRequest();
      }
      break;
    }
  }

  // A first event other than started is a late-joined session: the state is
  // derived from the event but cannot be authoritative (PRD §13.2).
  if (created && event.eventType !== "agent.started") {
    confidence = event.eventType === "agent.state_unknown" ? "unverified" : "inferred";
  }

  const stateChanged =
    created ||
    state !== base.state ||
    confidence !== base.stateConfidence ||
    !sameRequests(base.pendingRequests, pendingRequests) ||
    !sameTasks(base.tasks, tasks);

  const lastEventAt = latestTimestamp(base.lastEventAt, eventTime);
  const lastVerifiedAt =
    event.confidence === "authoritative" && confidence === "authoritative"
      ? now
      : base.lastVerifiedAt;

  const next: SessionRecord = {
    ...base,
    agentName: event.source.agentName,
    state,
    stateConfidence: confidence,
    lastEventAt,
    lastSeenAt: now,
    lastVerifiedAt,
    pendingRequests,
    tasks,
  };

  if (event.session.parentSessionId !== undefined) {
    next.parentSessionId = event.session.parentSessionId;
    if (event.session.isSubagent === true) {
      next.isSubagent = true;
    }
  }
  if (event.session.projectName !== undefined) {
    next.projectName = event.session.projectName;
  }
  if (event.session.workingDirectory !== undefined) {
    next.workingDirectory = event.session.workingDirectory;
  }

  let sequence = base.lastAcceptedSequence;
  if (event.sequence !== undefined && (sequence === undefined || event.sequence > sequence)) {
    sequence = event.sequence;
  }
  if (sequence !== undefined) {
    next.lastAcceptedSequence = sequence;
  }

  return {
    session: next,
    stateChanged,
    ...(openedRequest !== undefined ? { openedRequest } : {}),
    ...(closedRequest !== undefined ? { closedRequest } : {}),
    ...(completionScope !== undefined ? { completionScope } : {}),
  };
}
