import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@agent-attention/contract";
import { RollingRateLimiter, processEvent } from "@agent-attention/core";
import {
  createPipelineStore,
  openDatabase,
  type AgentAttentionStore,
} from "@agent-attention/storage";
import { afterEach, describe, expect, it } from "vitest";
import { makeEvent, makeSession } from "../core/event-factory";

const NOW = "2026-10-20T10:00:00Z";
const DAY_MS = 24 * 60 * 60 * 1000;

const dirs: string[] = [];
const stores: AgentAttentionStore[] = [];

function newStore(): AgentAttentionStore {
  const dir = mkdtempSync(join(tmpdir(), "agent-attention-store-"));
  dirs.push(dir);
  const db = openDatabase(join(dir, "agent-attention.db"), { busyTimeoutMs: 250 });
  const store = createPipelineStore(db, { retentionDays: 7 });
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("atomic dedupe claim", () => {
  it("claims a fingerprint once and counts later duplicates without touching the stored event", () => {
    const store = newStore();
    const event = makeEvent({ eventType: "agent.needs_input", eventId: "event-1" });

    expect(store.claimFingerprint("fingerprint-1", event.eventId, NOW)).toEqual({
      claimed: true,
    });
    store.recordEvent(event, {
      fingerprint: "fingerprint-1",
      late: false,
      duplicate: false,
    });

    const duplicate = store.claimFingerprint("fingerprint-1", "event-2", "2026-10-20T10:00:01Z");
    expect(duplicate).toEqual({ claimed: false, duplicateCount: 1 });

    const secondDuplicate = store.claimFingerprint(
      "fingerprint-1",
      "event-3",
      "2026-10-20T10:00:02Z",
    );
    expect(secondDuplicate).toEqual({ claimed: false, duplicateCount: 2 });

    const events = store.listEvents({ sessionId: "session-1" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: "event-1",
      fingerprint: "fingerprint-1",
    });
  });

  it("commits the claim and event insert in one transaction", () => {
    const store = newStore();
    const event = makeEvent({ eventType: "agent.started", eventId: "atomic-event" });
    const meta = { fingerprint: "atomic-fingerprint", late: false, duplicate: false };

    expect(store.claimAndRecordEvent(event, meta, NOW)).toEqual({ claimed: true });
    expect(
      store.claimAndRecordEvent(
        makeEvent({ eventType: "agent.started", eventId: "atomic-duplicate" }),
        meta,
        NOW,
      ),
    ).toEqual({ claimed: false, duplicateCount: 1 });
    expect(store.listEvents().map((row) => row.eventId)).toEqual(["atomic-event"]);

    // A failed insert rolls the claim back, leaving the fingerprint claimable.
    const bad = makeEvent({
      eventType: "agent.started",
      eventId: "atomic-bad",
      occurredAt: "not-a-timestamp",
      receivedAt: "not-a-timestamp",
    });
    expect(() =>
      store.claimAndRecordEvent(
        bad,
        { fingerprint: "atomic-rollback", late: false, duplicate: false },
        NOW,
      ),
    ).toThrow();
    expect(store.claimFingerprint("atomic-rollback", "atomic-retry", NOW)).toEqual({
      claimed: true,
    });
  });

  it("shares the unique constraint across two connections on the same file", () => {
    const store = newStore();
    const secondDb = openDatabase(join(dirs[dirs.length - 1]!, "agent-attention.db"), {
      busyTimeoutMs: 250,
    });
    const second = createPipelineStore(secondDb, { retentionDays: 7 });

    try {
      expect(store.claimFingerprint("shared", "event-a", NOW)).toEqual({ claimed: true });
      expect(second.claimFingerprint("shared", "event-b", NOW)).toEqual({
        claimed: false,
        duplicateCount: 1,
      });
    } finally {
      second.close();
    }
  });
});

describe("session repository", () => {
  it("round-trips every SessionRecord field", () => {
    const store = newStore();
    const session = makeSession({
      adapterId: "adapter-a",
      sessionId: "session-1",
      agentName: "Agent A",
      state: "waiting_for_approval",
      stateConfidence: "inferred",
      lastEventAt: "2026-10-20T09:59:00Z",
      lastSeenAt: "2026-10-20T10:00:00Z",
      lastVerifiedAt: "2026-10-20T09:30:00Z",
      pendingRequests: [
        {
          kind: "approval",
          requestId: "req-1",
          openedAt: "2026-10-20T09:45:00Z",
          remindersSent: 1,
        },
        {
          kind: "input",
          requestId: "req-2",
          openedAt: "2026-10-20T09:50:00Z",
          remindersSent: 0,
        },
      ],
      tasks: [
        {
          taskId: "task-1",
          state: "active",
          startedAt: "2026-10-20T09:00:00Z",
        },
        {
          taskId: "task-2",
          state: "completed",
          startedAt: "2026-10-20T08:00:00Z",
          endedAt: "2026-10-20T08:30:00Z",
        },
      ],
      isSubagent: true,
      parentSessionId: "parent-session",
      projectName: "project-name",
      workingDirectory: "C:\\work\\project",
      lastAcceptedSequence: 12,
    });

    store.saveSession(session);

    expect(store.loadSession("adapter-a", "session-1")).toEqual(session);
    expect(store.openRequests()).toHaveLength(2);
  });

  it("keeps resolved requests for history when a session is saved again", () => {
    const store = newStore();
    const session = makeSession({
      pendingRequests: [
        {
          kind: "input",
          requestId: "req-1",
          openedAt: "2026-10-20T09:45:00Z",
          remindersSent: 0,
        },
      ],
    });

    store.saveSession(session);
    store.saveSession({ ...session, pendingRequests: [] });

    expect(store.openRequests()).toHaveLength(0);
    const rows = store.db.raw
      .prepare(
        "SELECT request_id, resolved_at, resolution FROM pending_requests WHERE session_id = ?",
      )
      .all("session-1") as Array<{
      request_id: string;
      resolved_at: string | null;
      resolution: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resolved_at).not.toBeNull();
    expect(rows[0]?.resolution).toBe("unknown");
  });

  it("lists sessions newest first and removes ended sessions only when expired", () => {
    const store = newStore();
    store.saveSession(
      makeSession({
        sessionId: "working-session",
        lastSeenAt: "2026-10-01T09:00:00Z",
      }),
    );
    store.saveSession(
      makeSession({
        sessionId: "ended-session",
        state: "ended",
        lastSeenAt: "2026-10-01T09:00:00Z",
      }),
    );

    const result = store.purgeExpired(NOW);
    expect(result.sessions).toBe(1);
    expect(store.listSessions().map((session) => session.sessionId)).toEqual(["working-session"]);
  });
});

describe("event and delivery repositories", () => {
  it("stores enumerated event fields and filters them", () => {
    const store = newStore();
    const event = makeEvent({
      eventType: "agent.needs_approval",
      eventId: "event-approval",
      taskId: "task-1",
      sequence: 3,
      receivedAt: "2026-10-20T10:00:00Z",
      occurredAt: "2026-10-20T09:59:59Z",
      details: {
        summaryCode: "APPROVAL_REQUIRED",
        requestId: "req-1",
        completionScope: "task",
        resolution: "approved",
        resumeReason: "new_prompt",
        failureCode: "host_error",
        turnDurationMs: 1234,
      },
    });

    store.recordEvent(event, {
      fingerprint: "fingerprint-event",
      late: true,
      duplicate: false,
    });

    const events = store.listEvents({
      adapterId: "adapter-a",
      sessionId: "session-1",
      eventType: "agent.needs_approval",
      from: "2026-10-20T00:00:00Z",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: "event-approval",
      adapterId: "adapter-a",
      sessionId: "session-1",
      taskId: "task-1",
      eventType: "agent.needs_approval",
      summaryCode: "APPROVAL_REQUIRED",
      requestId: "req-1",
      sequence: 3,
      occurredAt: "2026-10-20T09:59:59Z",
      receivedAt: "2026-10-20T10:00:00Z",
      confidence: "authoritative",
      late: true,
      fingerprint: "fingerprint-event",
    });
    expect(events[0]?.details).toEqual(event.details);
    expect(store.listEvents({ eventType: "agent.completed" })).toHaveLength(0);
  });

  it("upserts delivery outcomes per event and channel", () => {
    const store = newStore();

    store.recordDelivery({
      eventId: "event-1",
      channel: "sound",
      status: "delivered",
      attemptedAt: "2026-10-20T10:00:00Z",
    });
    store.recordDelivery({
      eventId: "event-1",
      channel: "sound",
      status: "suppressed",
      reason: "quiet_hours",
      attemptedAt: "2026-10-20T10:00:01Z",
    });
    store.recordDelivery({
      eventId: "event-1",
      channel: "desktop",
      status: "failed",
      errorCode: "toast_unavailable",
      attemptedAt: "2026-10-20T10:00:02Z",
    });

    const deliveries = store.listDeliveries("event-1");
    expect(deliveries).toHaveLength(2);
    expect(deliveries.find((delivery) => delivery.channel === "sound")).toMatchObject({
      status: "suppressed",
      reason: "quiet_hours",
    });
    expect(deliveries.find((delivery) => delivery.channel === "desktop")).toMatchObject({
      status: "failed",
      errorCode: "toast_unavailable",
    });
  });
});

describe("retention", () => {
  it("purges only expired dedupe records and old events, deliveries, and requests", () => {
    const store = newStore();
    const oldNow = new Date(Date.parse(NOW) - 10 * DAY_MS).toISOString();

    expect(store.claimFingerprint("old-fingerprint", "old-event", oldNow)).toEqual({
      claimed: true,
    });
    expect(store.claimFingerprint("fresh-fingerprint", "fresh-event", NOW)).toEqual({
      claimed: true,
    });

    store.recordEvent(
      makeEvent({
        eventType: "agent.started",
        eventId: "old-event",
        receivedAt: oldNow,
        occurredAt: oldNow,
      }),
      { fingerprint: "old-fingerprint", late: false, duplicate: false },
    );
    store.recordEvent(
      makeEvent({
        eventType: "agent.started",
        eventId: "fresh-event",
        receivedAt: NOW,
        occurredAt: NOW,
      }),
      { fingerprint: "fresh-fingerprint", late: false, duplicate: false },
    );

    store.recordDelivery({
      eventId: "old-event",
      channel: "sound",
      status: "delivered",
      attemptedAt: oldNow,
    });
    store.recordDelivery({
      eventId: "fresh-event",
      channel: "sound",
      status: "delivered",
      attemptedAt: NOW,
    });

    const result = store.purgeExpired(NOW);

    expect(result.dedupeRecords).toBe(1);
    expect(result.events).toBe(1);
    expect(result.deliveries).toBe(1);
    expect(store.listEvents().map((event) => event.eventId)).toEqual(["fresh-event"]);
    expect(store.listDeliveries("old-event")).toHaveLength(0);
    expect(store.listDeliveries("fresh-event")).toHaveLength(1);
    expect(store.claimFingerprint("old-fingerprint", "old-event", NOW)).toEqual({
      claimed: true,
    });
  });
});

describe("PipelineStore integration", () => {
  it("persists the first event and stops a duplicate without touching state or history", () => {
    const store = newStore();
    const event = makeEvent({
      eventType: "agent.started",
      eventId: "event-started",
      receivedAt: NOW,
      occurredAt: NOW,
    });
    const deps = {
      store,
      config: defaultConfig,
      clock: {
        now: () => NOW,
        nowMs: () => Date.parse(NOW),
      },
      rateLimiter: new RollingRateLimiter(defaultConfig.rateLimit.maxAlertsPerMinute),
      quietHoursMinutes: () => 600,
    };

    const first = processEvent(event, deps);
    expect(first.status).toBe("processed");
    expect(store.listEvents()).toHaveLength(1);
    const saved = store.loadSession("adapter-a", "session-1");
    expect(saved).toMatchObject({
      state: "working",
      stateConfidence: "authoritative",
      lastSeenAt: NOW,
    });

    const duplicate = processEvent(event, deps);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.planned).toHaveLength(0);
    expect(store.listEvents()).toHaveLength(1);
    expect(store.loadSession("adapter-a", "session-1")).toEqual(saved);
  });
});
