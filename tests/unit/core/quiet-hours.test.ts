import type { AgentAttentionConfig, QuietHoursConfig } from "@agent-attention/contract";
import { defaultConfig } from "@agent-attention/contract";
import { describe, expect, it } from "vitest";
import {
  isWithinQuietHours,
  parseClockMinutes,
  quietHoursSuppressions,
} from "@agent-attention/core";

function configWithQuietHours(overrides: Partial<QuietHoursConfig>): AgentAttentionConfig {
  return {
    ...defaultConfig,
    quietHours: { ...defaultConfig.quietHours, ...overrides },
  };
}

const ALWAYS_SUPPRESS: QuietHoursConfig = {
  enabled: true,
  startTime: "23:00",
  endTime: "08:00",
  suppressSound: true,
  suppressVoice: true,
  suppressDesktop: true,
};

describe("parseClockMinutes", () => {
  it.each([
    ["00:00", 0],
    ["08:00", 480],
    ["12:00", 720],
    ["23:00", 1380],
    ["23:59", 1439],
  ])("parses %s as %i minutes of day", (value, expected) => {
    expect(parseClockMinutes(value)).toBe(expected);
  });

  it.each([
    "",
    "7:00",
    "23:0",
    "24:00",
    "23:60",
    "23:00:00",
    " 23:00",
    "23:00 ",
    "23:00Z",
    "ab:cd",
    "-1:00",
  ])("rejects malformed clock value %j", (value) => {
    expect(parseClockMinutes(value)).toBeUndefined();
  });
});

describe("isWithinQuietHours (F8-R1, AC-F8-07)", () => {
  it("suppresses 23:30 and 02:00 but not 12:00 for 23:00–08:00 (AC-F8-07)", () => {
    expect(isWithinQuietHours(23 * 60 + 30, 23 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietHours(2 * 60, 23 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietHours(12 * 60, 23 * 60, 8 * 60)).toBe(false);
  });

  it("includes the start boundary and excludes the end boundary", () => {
    expect(isWithinQuietHours(23 * 60, 23 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietHours(0, 23 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietHours(8 * 60 - 1, 23 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietHours(8 * 60, 23 * 60, 8 * 60)).toBe(false);
  });

  it("never suppresses when start equals end", () => {
    expect(isWithinQuietHours(23 * 60, 23 * 60, 23 * 60)).toBe(false);
    expect(isWithinQuietHours(0, 0, 0)).toBe(false);
    expect(isWithinQuietHours(12 * 60, 23 * 60, 23 * 60)).toBe(false);
  });

  it("supports same-day ranges with a half-open interval", () => {
    expect(isWithinQuietHours(9 * 60, 9 * 60, 17 * 60)).toBe(true);
    expect(isWithinQuietHours(17 * 60 - 1, 9 * 60, 17 * 60)).toBe(true);
    expect(isWithinQuietHours(17 * 60, 9 * 60, 17 * 60)).toBe(false);
    expect(isWithinQuietHours(9 * 60 - 1, 9 * 60, 17 * 60)).toBe(false);
  });

  it("evaluates wall-clock minutes only, so a DST gap cannot throw (AC-F8-07)", () => {
    const start = 90; // 01:30
    const end = 210; // 03:30
    const nonexistentLocalTime = 150; // 02:30 on a spring-forward day

    expect(() => isWithinQuietHours(nonexistentLocalTime, start, end)).not.toThrow();
    expect(isWithinQuietHours(nonexistentLocalTime, start, end)).toBe(true);
  });
});

describe("quietHoursSuppressions (F8-R2, AC-F8-07)", () => {
  it("suppresses every configured channel inside a cross-midnight range", () => {
    const config = configWithQuietHours(ALWAYS_SUPPRESS);

    expect(quietHoursSuppressions(config, 23 * 60 + 30)).toEqual({
      sound: true,
      voice: true,
      desktop: true,
    });
    expect(quietHoursSuppressions(config, 2 * 60)).toEqual({
      sound: true,
      voice: true,
      desktop: true,
    });
    expect(quietHoursSuppressions(config, 12 * 60)).toEqual({
      sound: false,
      voice: false,
      desktop: false,
    });
  });

  it("honors the inclusive start and exclusive end boundaries", () => {
    const config = configWithQuietHours(ALWAYS_SUPPRESS);

    expect(quietHoursSuppressions(config, 23 * 60)).toEqual({
      sound: true,
      voice: true,
      desktop: true,
    });
    expect(quietHoursSuppressions(config, 8 * 60)).toEqual({
      sound: false,
      voice: false,
      desktop: false,
    });
  });

  it("never suppresses when start equals end", () => {
    const config = configWithQuietHours({
      ...ALWAYS_SUPPRESS,
      startTime: "23:00",
      endTime: "23:00",
    });

    expect(quietHoursSuppressions(config, 23 * 60)).toEqual({
      sound: false,
      voice: false,
      desktop: false,
    });
    expect(quietHoursSuppressions(config, 12 * 60)).toEqual({
      sound: false,
      voice: false,
      desktop: false,
    });
  });

  it("never suppresses when quiet hours are disabled", () => {
    const config = configWithQuietHours({ ...ALWAYS_SUPPRESS, enabled: false });

    expect(quietHoursSuppressions(config, 23 * 60 + 30)).toEqual({
      sound: false,
      voice: false,
      desktop: false,
    });
    expect(quietHoursSuppressions(config, 2 * 60)).toEqual({
      sound: false,
      voice: false,
      desktop: false,
    });
  });

  it("applies each channel flag independently (F8-R2)", () => {
    const soundAndDesktop = configWithQuietHours({
      enabled: true,
      startTime: "22:00",
      endTime: "06:00",
      suppressSound: true,
      suppressVoice: false,
      suppressDesktop: true,
    });
    const voiceOnly = configWithQuietHours({
      enabled: true,
      startTime: "22:00",
      endTime: "06:00",
      suppressSound: false,
      suppressVoice: true,
      suppressDesktop: false,
    });

    expect(quietHoursSuppressions(soundAndDesktop, 23 * 60)).toEqual({
      sound: true,
      voice: false,
      desktop: true,
    });
    expect(quietHoursSuppressions(voiceOnly, 23 * 60)).toEqual({
      sound: false,
      voice: true,
      desktop: false,
    });
  });

  it("supports same-day ranges", () => {
    const config = configWithQuietHours({
      enabled: true,
      startTime: "09:00",
      endTime: "17:00",
      suppressSound: true,
      suppressVoice: true,
      suppressDesktop: false,
    });

    expect(quietHoursSuppressions(config, 10 * 60)).toEqual({
      sound: true,
      voice: true,
      desktop: false,
    });
    expect(quietHoursSuppressions(config, 18 * 60)).toEqual({
      sound: false,
      voice: false,
      desktop: false,
    });
  });

  it("fails open when configured times are malformed instead of throwing", () => {
    const badStart = configWithQuietHours({ ...ALWAYS_SUPPRESS, startTime: "25:00" });
    const badEnd = configWithQuietHours({ ...ALWAYS_SUPPRESS, endTime: "08:60" });

    expect(quietHoursSuppressions(badStart, 12 * 60)).toEqual({
      sound: false,
      voice: false,
      desktop: false,
    });
    expect(quietHoursSuppressions(badEnd, 12 * 60)).toEqual({
      sound: false,
      voice: false,
      desktop: false,
    });
  });
});
