import type { AgentAttentionConfig, RemindersConfig } from "@agent-attention/contract";
import { defaultConfig } from "@agent-attention/contract";
import type { PendingRequest } from "@agent-attention/core";
import { planReminderTimers, reminderTextKind } from "@agent-attention/core";
import { describe, expect, it } from "vitest";

function configWithReminders(overrides: Partial<RemindersConfig>): AgentAttentionConfig {
  return {
    ...defaultConfig,
    reminders: { ...defaultConfig.reminders, ...overrides },
  };
}

const OPENED_AT = "2026-10-20T10:00:00.000Z";

function pendingRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    kind: "approval",
    requestId: "request-1",
    openedAt: OPENED_AT,
    remindersSent: 0,
    ...overrides,
  };
}

describe("reminderTextKind", () => {
  it("identifies reminder rows for the template layer (F14-R4)", () => {
    expect(reminderTextKind).toBe("reminder");
  });
});

describe("planReminderTimers", () => {
  it("produces no timer when reminders are disabled (AC-F14-03)", () => {
    const request = pendingRequest();
    const config = configWithReminders({ enabled: false });

    expect(planReminderTimers(request, config, "2026-10-20T10:01:00.000Z")).toBeUndefined();
  });

  it("schedules exactly one timer at openedAt plus afterMinutes", () => {
    const request = pendingRequest();
    const config = configWithReminders({ enabled: true, afterMinutes: 10, maxReminders: 1 });

    expect(planReminderTimers(request, config, "2026-10-20T10:09:00.000Z")).toEqual({
      requestId: "request-1",
      kind: "approval",
      dueAt: "2026-10-20T10:10:00.000Z",
    });
  });

  it("keeps the timer while the due time is still in the future", () => {
    const request = pendingRequest();
    const config = configWithReminders({ enabled: true, afterMinutes: 10, maxReminders: 1 });

    expect(planReminderTimers(request, config, OPENED_AT)).toBeDefined();
    expect(planReminderTimers(request, config, "2026-10-20T10:09:59.999Z")).toBeDefined();
  });

  it("returns no timer once the due time is not after now", () => {
    const request = pendingRequest();
    const config = configWithReminders({ enabled: true, afterMinutes: 10, maxReminders: 1 });

    expect(planReminderTimers(request, config, "2026-10-20T10:10:00.000Z")).toBeUndefined();
    expect(planReminderTimers(request, config, "2026-10-20T10:11:00.000Z")).toBeUndefined();
  });

  it("returns no timer once maxReminders have been sent (AC-F14-01)", () => {
    const config = configWithReminders({ enabled: true, afterMinutes: 10, maxReminders: 1 });

    expect(
      planReminderTimers(pendingRequest({ remindersSent: 1 }), config, "2026-10-20T10:01:00.000Z"),
    ).toBeUndefined();
  });

  it("allows remaining reminders below maxReminders", () => {
    const config = configWithReminders({ enabled: true, afterMinutes: 10, maxReminders: 2 });

    expect(
      planReminderTimers(pendingRequest({ remindersSent: 1 }), config, "2026-10-20T10:01:00.000Z"),
    ).toBeDefined();
    expect(
      planReminderTimers(pendingRequest({ remindersSent: 2 }), config, "2026-10-20T10:01:00.000Z"),
    ).toBeUndefined();
  });

  it("returns no timer for a resolved or closed request", () => {
    const config = configWithReminders({ enabled: true, afterMinutes: 10, maxReminders: 1 });

    expect(planReminderTimers(undefined, config, "2026-10-20T10:01:00.000Z")).toBeUndefined();
  });

  it("carries the pending request kind for input requests", () => {
    const request = pendingRequest({ kind: "input", requestId: "input-1" });
    const config = configWithReminders({ enabled: true, afterMinutes: 5, maxReminders: 1 });

    expect(planReminderTimers(request, config, OPENED_AT)).toEqual({
      requestId: "input-1",
      kind: "input",
      dueAt: "2026-10-20T10:05:00.000Z",
    });
  });

  it("does arithmetic across a date boundary", () => {
    const request = pendingRequest({ openedAt: "2026-12-31T23:55:00.000Z" });
    const config = configWithReminders({ enabled: true, afterMinutes: 10, maxReminders: 1 });

    expect(planReminderTimers(request, config, "2026-12-31T23:56:00.000Z")?.dueAt).toBe(
      "2027-01-01T00:05:00.000Z",
    );
  });

  it("returns no timer for unparseable timestamps", () => {
    const config = configWithReminders({ enabled: true, afterMinutes: 10, maxReminders: 1 });

    expect(
      planReminderTimers(pendingRequest({ openedAt: "not-a-time" }), config, OPENED_AT),
    ).toBeUndefined();
    expect(planReminderTimers(pendingRequest(), config, "not-a-time")).toBeUndefined();
  });

  it("does not mutate the pending request", () => {
    const request = pendingRequest();
    const before = { ...request };
    const config = configWithReminders({ enabled: true, afterMinutes: 10, maxReminders: 1 });

    planReminderTimers(request, config, "2026-10-20T10:01:00.000Z");

    expect(request).toEqual(before);
  });
});
