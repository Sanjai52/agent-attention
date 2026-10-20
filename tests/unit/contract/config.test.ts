import { describe, expect, it } from "vitest";
import { defaultConfig, parseConfig } from "@agent-attention/contract";

const prdDefaults = {
  schemaVersion: 2,
  globalMute: false,
  channels: { sound: true, voice: false, desktop: true },
  events: {
    needsInput: {
      enabled: true,
      sound: { enabled: true, soundId: "attention", volume: 35 },
      voice: { enabled: false },
      desktop: { enabled: true },
    },
    needsApproval: {
      enabled: true,
      sound: { enabled: true, soundId: "approval", volume: 45 },
      voice: { enabled: false },
      desktop: { enabled: true },
    },
    turnEnded: {
      enabled: true,
      sound: { enabled: true, soundId: "idle", volume: 25 },
      voice: { enabled: false },
      desktop: { enabled: true },
      minTurnSeconds: 15,
      graceMs: 1000,
    },
    completed: {
      enabled: true,
      sound: { enabled: true, soundId: "complete", volume: 25 },
      voice: { enabled: false },
      desktop: { enabled: true },
    },
    failed: {
      enabled: true,
      sound: { enabled: true, soundId: "failure", volume: 40 },
      voice: { enabled: false },
      desktop: { enabled: true },
      notifyOnCancelled: false,
    },
  },
  voice: { voiceId: null, volume: 50, rate: 0 },
  quietHours: {
    enabled: false,
    startTime: "23:00",
    endTime: "08:00",
    suppressSound: true,
    suppressVoice: true,
    suppressDesktop: false,
  },
  focus: { enabled: true, bypassForApproval: false },
  audio: { maxQueueLength: 3 },
  rateLimit: { maxAlertsPerMinute: 6, coalesceWindowSeconds: 5 },
  reminders: { enabled: false, afterMinutes: 10, maxReminders: 1 },
  privacy: { mode: "standard", showProjectName: true },
  subagents: { notify: false },
  deduplication: { fallbackWindowSeconds: 30 },
  stale: { workingAfterMinutes: 15 },
  activityHistory: { enabled: true, retentionDays: 7 },
};

describe("defaultConfig", () => {
  it("matches the PRD §8.3 schema verbatim", () => {
    expect(defaultConfig).toEqual(prdDefaults);
  });
});

describe("parseConfig", () => {
  it("accepts the defaults with zero diagnostics and a deep-equal config", () => {
    const result = parseConfig(defaultConfig);

    expect(result.diagnostics).toEqual([]);
    expect(result.config).toEqual(defaultConfig);
  });

  it("fills in defaults silently for missing keys", () => {
    const result = parseConfig({});

    expect(result.diagnostics).toEqual([]);
    expect(result.config).toEqual(defaultConfig);
  });

  it("falls back per key for a volume outside 0-100", () => {
    const result = parseConfig({ events: { needsInput: { sound: { volume: 150 } } } });

    expect(result.config.events.needsInput.sound.volume).toBe(35);
    expect(result.diagnostics).toContainEqual({
      keyPath: "events.needsInput.sound.volume",
      code: "invalid_value",
      message: expect.any(String),
      appliedFallback: 35,
    });
  });

  it("falls back to the event default for an unknown soundId", () => {
    const result = parseConfig({ events: { needsInput: { sound: { soundId: "nope" } } } });

    expect(result.config.events.needsInput.sound.soundId).toBe("attention");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        keyPath: "events.needsInput.sound.soundId",
        code: "invalid_value",
        appliedFallback: "attention",
      }),
    );
  });

  it("uses the turn-ended sound default for its own soundId", () => {
    const result = parseConfig({ events: { turnEnded: { sound: { soundId: "nope" } } } });

    expect(result.config.events.turnEnded.sound.soundId).toBe("idle");
  });

  it("falls back for an invalid quiet-hours time", () => {
    const result = parseConfig({ quietHours: { startTime: "25:00" } });

    expect(result.config.quietHours.startTime).toBe("23:00");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        keyPath: "quietHours.startTime",
        code: "invalid_value",
        appliedFallback: "23:00",
      }),
    );
  });

  it("requires exact HH:mm 24-hour times", () => {
    for (const startTime of ["8:00", "08:60", "24:00", "08:5", "0800"]) {
      const result = parseConfig({ quietHours: { startTime } });
      expect(result.config.quietHours.startTime).toBe("23:00");
    }

    const valid = parseConfig({ quietHours: { startTime: "09:05", endTime: "00:00" } });
    expect(valid.config.quietHours.startTime).toBe("09:05");
    expect(valid.config.quietHours.endTime).toBe("00:00");
  });

  it("rejects an old schemaVersion and returns defaults", () => {
    const result = parseConfig({ ...defaultConfig, globalMute: true, schemaVersion: 1 });

    expect(result.config).toEqual(defaultConfig);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ keyPath: "schemaVersion", code: "unsupported_version" }),
    );
  });

  it("reports and strips unknown keys", () => {
    const result = parseConfig({ ...defaultConfig, foo: 1 });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ keyPath: "foo", code: "unknown_key" }),
    );
    expect(result.config).not.toHaveProperty("foo");
  });

  it("reports and strips unknown nested keys", () => {
    const result = parseConfig({
      quietHours: { ...defaultConfig.quietHours, foo: "bar" },
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ keyPath: "quietHours.foo", code: "unknown_key" }),
    );
    expect(result.config.quietHours).not.toHaveProperty("foo");
  });

  it("recovers valid keys while falling back only for invalid ones", () => {
    const result = parseConfig({
      globalMute: true,
      events: { needsInput: { sound: { volume: -1 } } },
    });

    expect(result.config.globalMute).toBe(true);
    expect(result.config.events.needsInput.sound.volume).toBe(35);
  });

  it("keeps volume settings independent per event class and channel", () => {
    const result = parseConfig({
      events: {
        needsInput: { sound: { volume: 80 } },
        needsApproval: { sound: { volume: 10 } },
      },
    });

    expect(result.config.events.needsInput.sound.volume).toBe(80);
    expect(result.config.events.needsApproval.sound.volume).toBe(10);
    expect(result.config.events.turnEnded.sound.volume).toBe(25);
    expect(result.config.events.completed.sound.volume).toBe(25);
    expect(result.config.events.failed.sound.volume).toBe(40);
    expect(result.config.voice.volume).toBe(50);
    expect(result.diagnostics).toEqual([]);
  });
});
