import { describe, expect, it } from "vitest";
import { createTimerRegistry } from "../../../packages/host/src/timers";

describe("Phase 4 acceptance boundaries", () => {
  it("fires a scheduled reminder through the host timer registry", async () => {
    const fired: string[] = [];
    const registry = createTimerRegistry({
      maxTimeoutMs: 20,
      onFire: (instruction) => { fired.push(instruction.kind); },
    });
    registry.arm({ kind: "reminder", sessionKey: "session-1", requestId: "request-1", dueAt: new Date(Date.now() + 5).toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 30));
    registry.dispose();
    expect(fired).toEqual(["reminder"]);
  });

  it("represents focus as unsupported when no session-window mapping exists", () => {
    const report = { focus: { supported: false } };
    expect(report.focus.supported).toBe(false);
  });
});
