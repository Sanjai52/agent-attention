import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAgentEvent } from "@agent-attention/contract";
import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "../../../../adapters/claude-code/src/capabilities";
import { createNormalizer } from "../../../../adapters/claude-code/src/normalize";
import type { ClaudeCodeHookEvent } from "../../../../adapters/claude-code/src/types";

describe("Claude Code recorded fixture", () => {
  it("replays the sanitized verified hook sequence", () => {
    const path = resolve(process.cwd(), "tests", "fixtures", "claude-code", "basic-hooks.jsonl");
    const records = readFileSync(path, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as { kind: string; [key: string]: unknown });
    const normalizer = createNormalizer({ capabilities: capabilitiesFor(), now: () => Date.parse("2026-10-21T10:00:00.000Z") });
    const events = records.filter((record) => record.kind === "event").flatMap((record) => normalizer.normalize(record as unknown as ClaudeCodeHookEvent));
    expect(events.map((event) => event.eventType)).toEqual(["agent.started", "agent.needs_approval", "agent.approval_resolved", "agent.turn_ended", "agent.failed", "agent.session_ended"]);
    expect(events.every((event) => parseAgentEvent(event).ok)).toBe(true);
  });
});
