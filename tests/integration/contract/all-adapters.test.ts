import { parseAgentEvent, type AdapterCapabilities, type AgentEvent } from "@agent-attention/contract";
import { describe, expect, it } from "vitest";
import { capabilitiesFor as claudeCapabilities } from "../../../adapters/claude-code/src/capabilities";
import { createNormalizer as createClaudeNormalizer } from "../../../adapters/claude-code/src/normalize";
import { capabilitiesFor as openCodeCapabilities } from "../../../adapters/opencode/src/capabilities";
import { createNormalizer as createOpenCodeNormalizer } from "../../../adapters/opencode/src/normalize/normalizer";

function assertContract(capabilities: AdapterCapabilities, events: readonly AgentEvent[]): void {
  for (const event of events) {
    expect(event.source.adapterId).toBe(capabilities.adapterId);
    expect(capabilities.events[event.eventType].support).not.toBe("unsupported");
    expect(parseAgentEvent(event).ok).toBe(true);
  }
}

describe("shared adapter contract", () => {
  it("keeps both adapters capability-valid and payload-safe", () => {
    const adapters = [openCodeCapabilities("2.0.32"), claudeCapabilities("2.1.181")];
    for (const capabilities of adapters) {
      expect(Object.keys(capabilities.events)).toHaveLength(11);
      for (const [eventType, capability] of Object.entries(capabilities.events)) {
        if (capability.support !== "unsupported") expect(capability.sourceSignal).toBeTruthy();
        expect(eventType).toMatch(/^agent\./);
      }
    }
  });

  it("separates interleaved OpenCode and Claude Code sessions", () => {
    const claude = createClaudeNormalizer({ capabilities: claudeCapabilities(), now: () => Date.parse("2026-10-21T10:00:00.000Z") });
    const claudeEvents = claude.normalize({ hookEventName: "SessionStart", sessionId: "same-session", cwd: "C:\\claude" });
    const openCode = createOpenCodeNormalizer({
      context: { app: { name: "cli", version: "2.0.32" }, location: { directory: "C:\\opencode" } },
      capabilities: openCodeCapabilities("2.0.32"),
      now: () => Date.parse("2026-10-21T10:00:00.000Z"),
    });
    const openCodeEvents = openCode.normalize({ id: "evt-start", created: Date.parse("2026-10-21T10:00:00.000Z"), type: "session.execution.started", durable: { aggregateID: "same-session", seq: 1, version: 1 }, data: { sessionID: "same-session" } });
    const all = [...claudeEvents, ...openCodeEvents];
    assertContract(claudeCapabilities(), claudeEvents);
    assertContract(openCodeCapabilities(), openCodeEvents);
    expect(all.map((event) => event.source.adapterId)).toEqual(["claude-code", "opencode"]);
    expect(new Set(all.map((event) => `${event.source.adapterId}:${event.session.sessionId}`)).size).toBe(2);
  });
});
