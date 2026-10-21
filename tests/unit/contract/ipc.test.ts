import {
  AGENT_EVENT_TYPES,
  IPC_MAX_LINE_BYTES,
  IPC_PROTOCOL_VERSION,
  encodeIpcLine,
  encodeIpcRequest,
  encodeIpcResponse,
  parseIpcLine,
  parseIpcResponse,
  type AdapterCapabilities,
  type AdapterHello,
  type IpcRequest,
  type IpcResponse,
} from "@agent-attention/contract";
import { describe, expect, it } from "vitest";

function makeCapabilities(): AdapterCapabilities {
  const events = Object.fromEntries(
    AGENT_EVENT_TYPES.map((eventType) => [eventType, { support: "authoritative" }]),
  ) as AdapterCapabilities["events"];

  return {
    adapterId: "adapter-a",
    adapterVersion: "1.0.0",
    executionModel: "hook_process",
    events,
    eventIdsStable: true,
    supportsSequence: true,
    supportsTaskScope: true,
    supportsSubagents: true,
    supportsLiveness: true,
    supportsResolutionSignals: true,
  };
}

function hello(): AdapterHello {
  return {
    adapterId: "adapter-a",
    adapterVersion: "1.0.0",
    capabilities: makeCapabilities(),
  };
}

const requests: IpcRequest[] = [
  {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: "r-hello",
    kind: "adapter_hello",
    payload: hello(),
  },
  {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: "r-submit",
    kind: "submit_event",
    payload: { event: { eventId: "e-1", eventType: "agent.started" } },
  },
  {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: "r-status",
    kind: "status",
    payload: { json: true },
  },
  {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: "r-history",
    kind: "history",
    payload: { filters: { adapterId: "adapter-a", limit: 20 } },
  },
  {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: "r-preview",
    kind: "preview",
    payload: { eventClass: "needsApproval", channel: "sound", voice: false },
  },
  { protocolVersion: IPC_PROTOCOL_VERSION, id: "r-ping", kind: "ping", payload: {} },
  {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: "r-mute",
    kind: "mute",
    payload: { until: "2026-10-21T00:00:00Z" },
  },
  { protocolVersion: IPC_PROTOCOL_VERSION, id: "r-unmute", kind: "unmute", payload: {} },
  { protocolVersion: IPC_PROTOCOL_VERSION, id: "r-shutdown", kind: "shutdown", payload: {} },
];

describe("ipc protocol", () => {
  it("uses protocol version 1 and a 256 KiB line cap", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(1);
    expect(IPC_MAX_LINE_BYTES).toBe(256 * 1024);
  });

  it.each(requests)("round-trips a $kind request", (request) => {
    const encoded = encodeIpcLine(request);
    expect(encoded.endsWith("\n")).toBe(true);

    const parsed = parseIpcLine(encoded.slice(0, -1));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.request).toEqual(request);
  });

  it("round-trips success and failure responses", () => {
    const success: IpcResponse = {
      id: "r-1",
      ok: true,
      result: { status: "processed", planned: [] },
    };
    const failure: IpcResponse = {
      id: "r-2",
      ok: false,
      error: { code: "rejected_event", message: "bad event" },
    };

    for (const response of [success, failure]) {
      const parsed = parseIpcResponse(encodeIpcResponse(response).trimEnd());
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(parsed.error.message);
      }
      expect(parsed.response).toEqual(response);
    }
  });

  it("rejects a protocol version mismatch with unsupported_protocol", () => {
    const parsed = parseIpcLine(
      JSON.stringify({ protocolVersion: 2, id: "r-version", kind: "ping", payload: {} }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected a version error");
    }
    expect(parsed.error.code).toBe("unsupported_protocol");
    expect(parsed.error.id).toBe("r-version");
  });

  it("rejects an unknown kind with unknown_kind", () => {
    const parsed = parseIpcLine(
      JSON.stringify({ protocolVersion: 1, id: "r-kind", kind: "explode", payload: {} }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected an unknown kind error");
    }
    expect(parsed.error.code).toBe("unknown_kind");
  });

  it("rejects an invalid payload with invalid_payload", () => {
    const parsed = parseIpcLine(
      JSON.stringify({ protocolVersion: 1, id: "r-payload", kind: "adapter_hello", payload: {} }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected a payload error");
    }
    expect(parsed.error.code).toBe("invalid_payload");
  });

  it("answers malformed JSON with a typed parse error and keeps the id when readable", () => {
    const parsed = parseIpcLine('{"protocolVersion":1,"id":"r-broken","kind":');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected a malformed JSON error");
    }
    expect(parsed.error.code).toBe("invalid_payload");
    expect(parsed.error.id).toBe("r-broken");
    expect(parsed.error.message).toMatch(/malformed json/i);
  });

  it("rejects an oversized payload before parsing", () => {
    const oversized = `{"protocolVersion":1,"id":"r-big","kind":"ping","payload":{"x":"${"a".repeat(
      IPC_MAX_LINE_BYTES,
    )}"}}`;

    const parsed = parseIpcLine(oversized);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected an oversized payload error");
    }
    expect(parsed.error.code).toBe("invalid_payload");
    expect(parsed.error.message).toMatch(/256/);
  });

  it("validates encoded requests against the schemas", () => {
    const invalid = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      id: "r-invalid",
      kind: "submit_event",
      payload: {},
    } as unknown as IpcRequest;

    expect(() => encodeIpcRequest(invalid)).toThrow();
  });
});
