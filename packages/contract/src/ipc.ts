/**
 * IPC protocol for the Notification Host named pipe (PRD.md §9.2, §9.4).
 *
 * Wire format: one JSON object per newline-delimited line. Every request and
 * response is validated with Zod before it reaches host logic, so a malformed
 * or unsupported line produces a typed error rather than a crash. Lines are
 * capped at 256 KiB; the host rejects an oversized line before parsing it.
 *
 * The protocol version is independent of the event and config schema
 * versions. A version mismatch is reported as `unsupported_protocol`; an
 * unknown request kind as `unknown_kind`; a known kind with a bad payload as
 * `invalid_payload`.
 */

import { z } from "zod";

import { AGENT_EVENT_TYPES } from "./events";
import type { AdapterCapabilities } from "./capabilities";

export const IPC_PROTOCOL_VERSION = 1 as const;

/** Maximum UTF-8 bytes in one request line, excluding the trailing newline. */
export const IPC_MAX_LINE_BYTES = 256 * 1024;

export const IPC_ERROR_CODES = [
  "unsupported_protocol",
  "unknown_kind",
  "invalid_payload",
  "rejected_event",
  "unavailable",
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export interface IpcError {
  code: IpcErrorCode;
  message: string;
}

const timestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be an ISO timestamp");

const eventCapabilitySchema = z.object({
  support: z.enum(["authoritative", "inferred", "unsupported"]),
  sourceSignal: z.string().optional(),
  verifiedAgainst: z.string().optional(),
  notes: z.string().optional(),
});

const adapterCapabilitiesSchema = z.object({
  adapterId: z.string().min(1),
  adapterVersion: z.string().min(1),
  hostVersionRange: z.string().optional(),
  executionModel: z.enum(["in_process_plugin", "hook_process", "extension"]),
  events: z.object(
    Object.fromEntries(
      AGENT_EVENT_TYPES.map((eventType) => [eventType, eventCapabilitySchema]),
    ) as Record<(typeof AGENT_EVENT_TYPES)[number], typeof eventCapabilitySchema>,
  ),
  eventIdsStable: z.boolean(),
  supportsSequence: z.boolean(),
  supportsTaskScope: z.boolean(),
  supportsSubagents: z.boolean(),
  supportsLiveness: z.boolean(),
  supportsResolutionSignals: z.boolean(),
});

export interface AdapterHello {
  adapterId: string;
  adapterVersion: string;
  capabilities: AdapterCapabilities;
}

export interface SubmitEvent {
  /** Validated by the core pipeline, not by the transport envelope. */
  event: unknown;
}

export interface StatusRequest {
  json: boolean;
}

export interface HistoryFilters {
  adapterId?: string;
  sessionId?: string;
  eventType?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface HistoryRequest {
  filters: HistoryFilters;
}

export type PreviewEventClass =
  | "needsInput"
  | "needsApproval"
  | "turnEnded"
  | "completed"
  | "failed";

export interface PreviewRequest {
  eventClass: PreviewEventClass;
  channel: "sound" | "voice" | "desktop";
  voice: boolean;
}

export interface MuteRequest {
  until?: string;
}

export interface RequestPayloads {
  adapter_hello: AdapterHello;
  submit_event: SubmitEvent;
  status: StatusRequest;
  history: HistoryRequest;
  preview: PreviewRequest;
  ping: Record<string, never>;
  mute: MuteRequest;
  unmute: Record<string, never>;
  shutdown: Record<string, never>;
}

export type IpcRequestKind = keyof RequestPayloads;

export type IpcRequest = {
  [K in IpcRequestKind]: {
    protocolVersion: typeof IPC_PROTOCOL_VERSION;
    id: string;
    kind: K;
    payload: RequestPayloads[K];
  };
}[IpcRequestKind];

export interface IpcSuccessResponse {
  id: string;
  ok: true;
  result: unknown;
}

export interface IpcFailureResponse {
  id: string;
  ok: false;
  error: IpcError;
}

export type IpcResponse = IpcSuccessResponse | IpcFailureResponse;

export interface IpcParseError {
  ok: false;
  error: IpcError & { id?: string };
}

export type IpcParseResult =
  | { ok: true; request: IpcRequest }
  | IpcParseError;

export type IpcResponseParseResult =
  | { ok: true; response: IpcResponse }
  | IpcParseError;

const helloPayloadSchema = z.object({
  adapterId: z.string().min(1).max(128),
  adapterVersion: z.string().min(1).max(128),
  capabilities: adapterCapabilitiesSchema,
});

const historyFiltersSchema = z
  .object({
    adapterId: z.string().min(1).max(128).optional(),
    sessionId: z.string().min(1).max(256).optional(),
    eventType: z.string().min(1).max(128).optional(),
    since: timestampSchema.optional(),
    until: timestampSchema.optional(),
    limit: z.number().int().positive().max(10_000).optional(),
  })
  .default({});

const requestPayloadSchemas: {
  [K in IpcRequestKind]: z.ZodType<RequestPayloads[K]>;
} = {
  adapter_hello: helloPayloadSchema as unknown as z.ZodType<AdapterHello>,
  submit_event: z.object({ event: z.unknown() }),
  status: z.object({ json: z.boolean().default(false) }),
  history: z.object({ filters: historyFiltersSchema }),
  preview: z.object({
    eventClass: z.enum([
      "needsInput",
      "needsApproval",
      "turnEnded",
      "completed",
      "failed",
    ]),
    channel: z.enum(["sound", "voice", "desktop"]),
    voice: z.boolean().default(false),
  }),
  ping: z.object({}).default({}),
  mute: z.object({ until: timestampSchema.optional() }),
  unmute: z.object({}).default({}),
  shutdown: z.object({}).default({}),
};

const envelopeSchema = z.object({
  protocolVersion: z.number().int(),
  id: z.string().min(1).max(128),
  kind: z.string().min(1).max(64),
  payload: z.unknown().optional(),
});

const responseSchema = z.discriminatedUnion("ok", [
  z.object({
    id: z.string().min(1).max(128),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    id: z.string().min(1).max(128),
    ok: z.literal(false),
    error: z.object({
      code: z.enum(IPC_ERROR_CODES),
      message: z.string(),
    }),
  }),
]);

export function isIpcRequestKind(value: string): value is IpcRequestKind {
  return Object.prototype.hasOwnProperty.call(requestPayloadSchemas, value);
}

function bestEffortId(raw: string): string | undefined {
  const match = /"id"\s*:\s*"([^"]{1,128})"/.exec(raw);
  return match?.[1];
}

function parseError(
  code: IpcErrorCode,
  message: string,
  id?: string,
): IpcParseError {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(id === undefined ? {} : { id }),
    },
  };
}

function issueSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "payload";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Parse one newline-delimited request. The newline may or may not be present;
 * a trailing carriage return is ignored so CRLF clients work.
 */
export function parseIpcLine(line: string): IpcParseResult {
  const raw = line.endsWith("\r") ? line.slice(0, -1) : line;

  if (raw.trim().length === 0) {
    return parseError("invalid_payload", "empty request line");
  }

  if (Buffer.byteLength(raw, "utf8") > IPC_MAX_LINE_BYTES) {
    return parseError(
      "invalid_payload",
      `request exceeds the 256 KiB (${IPC_MAX_LINE_BYTES}-byte) line limit`,
      bestEffortId(raw),
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return parseError(
      "invalid_payload",
      "malformed JSON request",
      bestEffortId(raw),
    );
  }

  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) {
    return parseError(
      "invalid_payload",
      `invalid request envelope: ${issueSummary(envelope.error)}`,
      bestEffortId(raw),
    );
  }

  if (envelope.data.protocolVersion !== IPC_PROTOCOL_VERSION) {
    return parseError(
      "unsupported_protocol",
      `unsupported IPC protocol version ${envelope.data.protocolVersion}; expected ${IPC_PROTOCOL_VERSION}`,
      envelope.data.id,
    );
  }

  if (!isIpcRequestKind(envelope.data.kind)) {
    return parseError(
      "unknown_kind",
      `unknown request kind ${envelope.data.kind}`,
      envelope.data.id,
    );
  }

  const payloadSchema = requestPayloadSchemas[envelope.data.kind];
  const payload = payloadSchema.safeParse(envelope.data.payload ?? {});
  if (!payload.success) {
    return parseError(
      "invalid_payload",
      `invalid ${envelope.data.kind} payload: ${issueSummary(payload.error)}`,
      envelope.data.id,
    );
  }

  return {
    ok: true,
    request: {
      protocolVersion: IPC_PROTOCOL_VERSION,
      id: envelope.data.id,
      kind: envelope.data.kind,
      payload: payload.data,
    } as IpcRequest,
  };
}

/** Validate a request and encode it as a single newline-terminated line. */
export function encodeIpcRequest(request: IpcRequest): string {
  const payloadSchema = requestPayloadSchemas[request.kind];
  const payload = payloadSchema.parse(request.payload);
  return `${JSON.stringify({
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: request.id,
    kind: request.kind,
    payload,
  })}\n`;
}

export function encodeIpcLine(request: IpcRequest): string {
  return encodeIpcRequest(request);
}

export function parseIpcResponse(line: string): IpcResponseParseResult {
  const raw = line.endsWith("\r") ? line.slice(0, -1) : line;

  if (Buffer.byteLength(raw, "utf8") > IPC_MAX_LINE_BYTES) {
    return parseError("invalid_payload", "response exceeds the line limit");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return parseError("invalid_payload", "malformed JSON response");
  }

  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) {
    return parseError(
      "invalid_payload",
      `invalid response envelope: ${issueSummary(parsed.error)}`,
    );
  }

  return { ok: true, response: parsed.data };
}

export function encodeIpcResponse(response: IpcResponse): string {
  return `${JSON.stringify(response)}\n`;
}
