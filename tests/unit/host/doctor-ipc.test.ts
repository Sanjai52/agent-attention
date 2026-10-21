import { describe, expect, it } from "vitest";
import { defaultConfig, IPC_PROTOCOL_VERSION } from "../../../packages/contract/src";
import { createConnection } from "../../../packages/host/src/connection";

describe("doctor IPC", () => {
  it("routes a doctor request through the host connection", async () => {
    const connection = createConnection({
      store: {
        recordDiagnostic() {},
        claimFingerprint: () => ({ claimed: true }),
        recordEvent() {},
        loadSession: () => undefined,
        saveSession() {},
      },
      config: structuredClone(defaultConfig),
      providers: {} as never,
      clock: { now: () => "2026-10-21T00:00:00.000Z", nowMs: () => 0 },
      doctor: async (json) => ({ json, focus: { supported: false } }),
    });
    await expect(connection.handleRequest({
      protocolVersion: IPC_PROTOCOL_VERSION,
      id: "doctor-1",
      kind: "doctor",
      payload: { json: true },
    })).resolves.toEqual({ id: "doctor-1", ok: true, result: { json: true, focus: { supported: false } } });
  });
});
