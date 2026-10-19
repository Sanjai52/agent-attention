import { describe, expect, it } from "vitest";
import {
  isVoiceSafeName,
  sanitizeDisplayName,
  shortSessionId,
} from "@agent-attention/contract";

describe("sanitizeDisplayName", () => {
  it("strips control and bidi characters", () => {
    expect(sanitizeDisplayName("pro\u202Eject\u0007")).toBe("project");
  });

  it("strips bidi isolates and C1 controls", () => {
    expect(sanitizeDisplayName("\u2066safe\u2069\u0085name")).toBe("safename");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeDisplayName("  my \t  project \n")).toBe("my project");
  });

  it("returns undefined for empty results", () => {
    expect(sanitizeDisplayName("")).toBeUndefined();
    expect(sanitizeDisplayName(" \t\n ")).toBeUndefined();
    expect(sanitizeDisplayName("\u0000\u202E")).toBeUndefined();
  });

  it("truncates to 64 chars with ellipsis", () => {
    const result = sanitizeDisplayName("x".repeat(80));
    expect(result).toHaveLength(64);
    expect(result?.endsWith("…")).toBe(true);
  });

  it("truncates to a custom length", () => {
    const result = sanitizeDisplayName("abcdef", 4);
    expect(result).toBe("abc…");
  });

  it("leaves strings at or below the limit unchanged", () => {
    expect(sanitizeDisplayName("a".repeat(64))).toBe("a".repeat(64));
  });
});

describe("isVoiceSafeName", () => {
  it("rejects shell metacharacters for voice", () => {
    expect(isVoiceSafeName('"; rm -rf ~ #')).toBe(false);
  });

  it("allows unicode letters in voice names", () => {
    expect(isVoiceSafeName("projëkt-über")).toBe(true);
  });

  it("allows letters, digits, space, dot, underscore, and hyphen", () => {
    expect(isVoiceSafeName("Project 42_v1.2-beta")).toBe(true);
  });

  it("rejects other punctuation, quotes, and control characters", () => {
    expect(isVoiceSafeName("project$(whoami)")).toBe(false);
    expect(isVoiceSafeName("project`id`")).toBe(false);
    expect(isVoiceSafeName("project%TEMP%")).toBe(false);
    expect(isVoiceSafeName("project/name")).toBe(false);
    expect(isVoiceSafeName("project\u0007name")).toBe(false);
    expect(isVoiceSafeName("")).toBe(false);
  });
});

describe("shortSessionId", () => {
  it("returns the first 8 hex characters of a SHA-256 hash", () => {
    expect(shortSessionId("session-123")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic and does not expose the raw id", () => {
    expect(shortSessionId("session-123")).toBe(shortSessionId("session-123"));
    expect(shortSessionId("session-123")).not.toBe(shortSessionId("session-124"));
    expect(shortSessionId("session-123")).not.toContain("session");
  });
});
