/**
 * Request dispatcher for one IPC connection (PRD.md §9.2, §14.2, §17.1).
 *
 * This module is deliberately socket-free: `createConnection` can be unit
 * tested without a named pipe. The pipe server owns framing and lifecycle.
 *
 * Identity: an `AdapterHello` binds the connection to exactly one adapter.
 * A later `SubmitEvent` whose `source.adapterId` differs is rejected before it
 * reaches the pipeline, so one adapter cannot overwrite another adapter's
 * session state.
 */

import type {
  AdapterCapabilities,
  AgentAttentionConfig,
  HistoryFilters,
  IpcErrorCode,
  IpcRequest,
  IpcResponse,
  PreviewRequest,
} from "@agent-attention/contract";
import { IPC_PROTOCOL_VERSION, type IpcRequestKind } from "@agent-attention/contract";
import type { ProviderSet } from "@agent-attention/notifications";
import {
  RollingRateLimiter,
  processEvent,
  type Clock,
  type GraceState,
  type PipelineDiagnostic,
  type PipelineStore,
  type PlannedNotification,
} from "@agent-attention/core";

export type {
  DesktopProvider,
  ProviderResult,
  ProviderSet,
  SoundProvider,
  SpeechProvider,
} from "@agent-attention/notifications";

export interface ConnectionDependencies {
  store: PipelineStore;
  config: AgentAttentionConfig;
  providers: ProviderSet;
  clock: Clock;
  capabilities?: AdapterCapabilities;
  rateLimiter?: RollingRateLimiter;
  grace?: GraceState;
  quietHoursMinutes?: (now: string) => number;
  status?: (json: boolean) => unknown;
  history?: (filters: HistoryFilters) => unknown | Promise<unknown>;
  preview?: (request: PreviewRequest) => unknown | Promise<unknown>;
  mute?: (until?: string) => void | Promise<void>;
  unmute?: () => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
  doctor?: (json: boolean) => unknown | Promise<unknown>;
  /** Persist-then-dispatch hook owned by the host lifecycle (Task 2.9). */
  dispatch?: (planned: PlannedNotification[]) => void | Promise<void>;
  onActivity?: () => void;
}

export interface HostConnection {
  readonly adapterId: string | undefined;
  readonly hasHello: boolean;
  handleRequest(request: IpcRequest): Promise<IpcResponse>;
}

function success(id: string, result: unknown): IpcResponse {
  return { id, ok: true, result };
}

function failure(id: string, code: IpcErrorCode, message: string): IpcResponse {
  return { id, ok: false, error: { code, message } };
}

function localMinutes(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getHours() * 60 + date.getMinutes();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function submittedAdapterId(event: unknown): string | undefined {
  if (!isRecord(event) || !isRecord(event.source)) {
    return undefined;
  }
  return typeof event.source.adapterId === "string" ? event.source.adapterId : undefined;
}

function rejectionMessage(
  diagnostics: Array<{ message: string }>,
): string {
  return diagnostics.length > 0
    ? diagnostics.map((diagnostic) => diagnostic.message).join("; ")
    : "event rejected by the pipeline";
}

export function createConnection(deps: ConnectionDependencies): HostConnection {
  let boundAdapterId: string | undefined;
  let boundCapabilities: AdapterCapabilities | undefined = deps.capabilities;
  let helloComplete = deps.capabilities !== undefined;

  const rateLimiter =
    deps.rateLimiter ??
    new RollingRateLimiter(deps.config.rateLimit.maxAlertsPerMinute);
  const quietHoursMinutes = deps.quietHoursMinutes ?? localMinutes;

  async function handleHello(
    request: Extract<IpcRequest, { kind: "adapter_hello" }>,
  ): Promise<IpcResponse> {
    if (helloComplete || boundAdapterId !== undefined) {
      return failure(
        request.id,
        "invalid_payload",
        "this connection is already registered to an adapter",
      );
    }

    const { adapterId, capabilities } = request.payload;
    if (capabilities.adapterId !== adapterId) {
      return failure(
        request.id,
        "invalid_payload",
        `capabilities.adapterId ${capabilities.adapterId} does not match ${adapterId}`,
      );
    }

    boundAdapterId = adapterId;
    boundCapabilities = capabilities;
    helloComplete = true;
    return success(request.id, {
      adapterId,
      protocolVersion: IPC_PROTOCOL_VERSION,
      registered: true,
    });
  }

  async function handleSubmit(
    request: Extract<IpcRequest, { kind: "submit_event" }>,
  ): Promise<IpcResponse> {
    const adapterId = submittedAdapterId(request.payload.event);
    if (
      boundAdapterId !== undefined &&
      adapterId !== undefined &&
      adapterId !== boundAdapterId
    ) {
      const diagnostic: PipelineDiagnostic = {
        code: "validation",
        message: `connection registered as ${boundAdapterId} cannot submit events for ${adapterId}`,
      };
      deps.store.recordDiagnostic(diagnostic);
      return failure(request.id, "rejected_event", diagnostic.message);
    }

    const result = processEvent(request.payload.event, {
      store: deps.store,
      config: deps.config,
      clock: deps.clock,
      rateLimiter,
      quietHoursMinutes,
      ...(boundCapabilities === undefined ? {} : { capabilities: boundCapabilities }),
      ...(deps.grace === undefined ? {} : { grace: deps.grace }),
    });

    if (result.status === "rejected") {
      return failure(request.id, "rejected_event", rejectionMessage(result.diagnostics));
    }

    // Hook shims submit one event per short-lived connection and do not perform
    // AdapterHello. Bind the connection to the first accepted event's adapter;
    // any later event for a different adapter is rejected above.
    if (boundAdapterId === undefined && adapterId !== undefined) {
      boundAdapterId = adapterId;
    }

    // The pipeline has already persisted the event and session before this
    // hook runs (PRD §14.2 step 8). Delivery runs independently so a slow
    // PowerShell provider never delays the IPC acknowledgement.
    if (deps.dispatch !== undefined && result.planned.length > 0) {
      try {
        void Promise.resolve(deps.dispatch(result.planned)).catch((error: unknown) => {
          deps.store.recordDiagnostic({
            code: "internal",
            message: error instanceof Error ? error.message : "dispatch failed",
          });
        });
      } catch (error) {
        deps.store.recordDiagnostic({
          code: "internal",
          message: error instanceof Error ? error.message : "dispatch failed",
        });
      }
    }

    return success(request.id, result);
  }

  function defaultStatus(): unknown {
    const maybeStore = deps.store as PipelineStore & {
      listSessions?: () => unknown[];
    };
    let sessions: number | undefined;
    try {
      sessions = maybeStore.listSessions?.().length;
    } catch {
      sessions = undefined;
    }

    return {
      protocolVersion: IPC_PROTOCOL_VERSION,
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      ...(sessions === undefined ? {} : { sessions }),
    };
  }

  async function dispatch(request: IpcRequest): Promise<IpcResponse> {
    switch (request.kind) {
      case "adapter_hello":
        return handleHello(request);
      case "submit_event":
        return handleSubmit(request);
      case "status":
        return success(
          request.id,
          deps.status === undefined ? defaultStatus() : await deps.status(request.payload.json),
        );
      case "doctor":
        if (deps.doctor === undefined) {
          return failure(request.id, "unavailable", "doctor is not available in this host");
        }
        return success(request.id, await deps.doctor(request.payload.json));
      case "history":
        if (deps.history === undefined) {
          return failure(request.id, "unavailable", "history is not available in this host");
        }
        return success(request.id, await deps.history(request.payload.filters));
      case "preview":
        if (deps.preview === undefined) {
          return failure(request.id, "unavailable", "preview is not available in this host");
        }
        return success(request.id, await deps.preview(request.payload));
      case "ping":
        return success(request.id, {
          pong: true,
          protocolVersion: IPC_PROTOCOL_VERSION,
          pid: process.pid,
        });
      case "mute":
        if (deps.mute === undefined) {
          deps.config.globalMute = true;
        } else {
          await deps.mute(request.payload.until);
        }
        return success(request.id, {
          muted: true,
          ...(request.payload.until === undefined ? {} : { until: request.payload.until }),
        });
      case "unmute":
        if (deps.unmute === undefined) {
          deps.config.globalMute = false;
        } else {
          await deps.unmute();
        }
        return success(request.id, { muted: false });
      case "shutdown":
        await deps.shutdown?.();
        return success(request.id, { shuttingDown: true });
      default: {
        const unexpected = request as { id: string; kind: string };
        return failure(
          unexpected.id,
          "unknown_kind",
          `unknown request kind ${unexpected.kind}`,
        );
      }
    }
  }

  return {
    get adapterId() {
      return boundAdapterId;
    },
    get hasHello() {
      return helloComplete || boundAdapterId !== undefined;
    },
    async handleRequest(request: IpcRequest): Promise<IpcResponse> {
      deps.onActivity?.();
      try {
        return await dispatch(request);
      } catch (error) {
        return failure(
          request.id,
          "unavailable",
          error instanceof Error ? error.message : "host request failed",
        );
      }
    },
  };
}

export type { IpcRequestKind };
