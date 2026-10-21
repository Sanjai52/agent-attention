/**
 * Notification Host lifecycle (PRD.md §9.2, §9.4, §13.4, §17.5).
 *
 * Startup order is deliberate. The pipe is created first so exclusive pipe
 * creation remains the single-instance guard: a second host fails before it
 * migrates, ingests spool files, or touches sessions. Only after the pipe is
 * ready does the host migrate, ingest the spool, reconcile sessions after the
 * previous host's death, and begin accepting requests.
 *
 * The runtime (storage + providers) is injected. This task owns orchestration
 * only; Tasks 2.1–2.2 and 2.8–2.13 supply the concrete store and providers.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import type {
  AgentAttentionConfig,
  AgentEvent,
  AgentEventType,
  HistoryFilters,
  PreviewRequest,
} from "@agent-attention/contract";
import {
  RollingRateLimiter,
  processEvent,
  reconcileAfterHostRestart,
  type Clock,
  type GraceState,
  type PipelineStore,
  type PlannedNotification,
  type SessionRecord,
} from "@agent-attention/core";
import {
  createAudioQueue,
  dispatchPlanned,
  providerAudioPlayer,
  type DeliveryRecord,
} from "@agent-attention/notifications";

import type { ProviderSet } from "./connection";
import { PipeServerError, createPipeServer, defaultPipeName, type PipeServer } from "./pipe-server";
import { createDefaultRuntime, defaultDataDir } from "./runtime";
import { ingestSpool } from "./spool-ingest";
import { createTimerRegistry, type HostTimerInstruction, type TimerRegistry } from "./timers";

export interface SpoolIngestSummary {
  ingested: number;
  rejected: number;
}

export interface HostRuntime {
  store: PipelineStore & { close?: () => void | Promise<void> };
  config: AgentAttentionConfig;
  providers: ProviderSet;
  clock: Clock;
  migrate(): void | Promise<void>;
  /** Overrides the pipe name; otherwise `--pipe` or the SID-derived default. */
  pipeName?: string;
  listSessions?(): SessionRecord[];
  /** Count of sessions that should keep the host alive. */
  activeSessions?(): number;
  ingestSpool?(dir: string): Promise<SpoolIngestSummary>;
  onTimer?(instruction: HostTimerInstruction): void | Promise<void>;
  hardenPipeAcl?(address: string): void | Promise<void>;
  history?(filters: HistoryFilters): unknown | Promise<unknown>;
  preview?(request: PreviewRequest): unknown | Promise<unknown>;
  mute?(until?: string): void | Promise<void>;
  unmute?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface RunHostOptions {
  signal?: AbortSignal;
  onReady?: (server: PipeServer) => void;
  /** How often the idle condition is re-evaluated. Default 30 s. */
  idleCheckIntervalMs?: number;
  noIngest?: boolean;
  noIdleExit?: boolean;
}

export interface ShouldExitInput {
  activeSessions: number;
  openConnections: number;
  lastActivityAt: number;
  nowMs: number;
  idleMinutes: number;
}

const MINUTE_MS = 60_000;
const HOST_TIMER_SESSION_KEY = "host";

const EVENT_CONFIG_KEYS: Readonly<
  Partial<Record<AgentEventType, keyof AgentAttentionConfig["events"]>>
> = {
  "agent.needs_input": "needsInput",
  "agent.needs_approval": "needsApproval",
  "agent.turn_ended": "turnEnded",
  "agent.completed": "completed",
  "agent.failed": "failed",
};

/**
 * Idle exit is allowed only when no session can still be live and no client is
 * connected, and that has been true for the full idle window. An `unknown`
 * session is not live: PRD §13.4 says a prior `working` state must not be
 * assumed after a restart.
 */
export function shouldExit(input: ShouldExitInput): boolean {
  if (input.activeSessions > 0 || input.openConnections > 0) {
    return false;
  }

  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.lastActivityAt)) {
    return false;
  }

  const idleMs = Math.max(0, input.idleMinutes) * MINUTE_MS;
  return input.nowMs - input.lastActivityAt >= idleMs;
}

export function isLiveSessionState(state: SessionRecord["state"]): boolean {
  return (
    state === "working" ||
    state === "waiting_for_input" ||
    state === "waiting_for_approval" ||
    state === "idle"
  );
}

/**
 * Project every persisted session after a host restart. `working` becomes
 * `unknown`; terminal and waiting states are preserved (PRD §13.4, AC-P).
 */
export function reconcileSessions(
  sessions: readonly SessionRecord[],
  now: string,
): SessionRecord[] {
  return sessions.map((session) => reconcileAfterHostRestart(session, now));
}

function liveSessionCount(runtime: HostRuntime): number {
  if (runtime.activeSessions !== undefined) {
    return runtime.activeSessions();
  }

  const sessions = runtime.listSessions?.() ?? [];
  return sessions.filter((session) => isLiveSessionState(session.state)).length;
}

/** `%LOCALAPPDATA%\\AgentAttention\\spool` on Windows (PRD §9.2). */
export function defaultSpoolDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(root, "AgentAttention", "spool");
}

function parseArgs(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }

    if (!argument.startsWith("--")) {
      continue;
    }

    const equals = argument.indexOf("=");
    if (equals > 0) {
      parsed.set(argument.slice(2, equals), argument.slice(equals + 1));
      continue;
    }

    const name = argument.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      parsed.set(name, next);
      index += 1;
    } else {
      parsed.set(name, true);
    }
  }

  return parsed;
}

function numberArg(value: string | true | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringArg(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function writeDiagnostic(message: string): void {
  try {
    process.stderr.write(`agent-attention host: ${message}\n`);
  } catch {
    // A closed stderr must not change lifecycle behavior.
  }
}

/** Local wall-clock minutes (0–1439) for quiet hours (PRD §9.4). */
function localMinutes(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getHours() * 60 + date.getMinutes();
}

async function closeRuntime(runtime: HostRuntime): Promise<void> {
  try {
    await runtime.shutdown?.();
  } catch {
    // Shutdown hooks are best-effort; the store close still runs.
  }
  try {
    await runtime.store.close?.();
  } catch {
    // Never throw from teardown after the pipe is already gone.
  }
}

/**
 * Run one Notification Host process until a shutdown signal, an RPC shutdown,
 * or the idle condition. Returns the process exit code: 0 for a normal stop or
 * an already-running instance, 1 for a startup failure.
 *
 * `runtime` is injectable for tests and doctor; when omitted, the production
 * composition root opens storage and the Windows providers lazily.
 */
export async function runHost(
  argv: readonly string[],
  runtime?: HostRuntime,
  options: RunHostOptions = {},
): Promise<number> {
  const args = parseArgs(argv);
  const dataDir = stringArg(args.get("data-dir"));
  runtime ??= createDefaultRuntime({
    dataDir: dataDir ?? defaultDataDir(),
  });

  const pipeName = stringArg(args.get("pipe")) ?? runtime.pipeName ?? defaultPipeName();
  const spoolDir =
    dataDir === undefined
      ? (stringArg(args.get("spool-dir")) ?? defaultSpoolDir())
      : join(dataDir, "spool");
  const idleMinutes = numberArg(args.get("idle-minutes")) ?? 10;
  const idleCheckIntervalMs = options.idleCheckIntervalMs ?? 30_000;
  const noIdleExit = options.noIdleExit === true || args.has("no-idle-exit");
  const noIngest = options.noIngest === true || args.has("no-ingest");

  // One limiter and one grace map for every submit path: pipe connections and
  // spool replay must not bypass each other's alert budget or pending turn-end
  // state (PRD §9.4, §14.2).
  const rateLimiter = new RollingRateLimiter(runtime.config.rateLimit.maxAlertsPerMinute);
  const grace: GraceState = {
    pending: new Map(),
    graceMs: runtime.config.events.turnEnded.graceMs,
  };
  const quietHoursMinutes = (now: string): number => localMinutes(now);

  const queue = createAudioQueue({
    maxQueueLength: runtime.config.audio.maxQueueLength,
    play: providerAudioPlayer(runtime.providers),
  });
  const deliverySink = runtime.store as PipelineStore & {
    recordDelivery?: (record: DeliveryRecord) => void;
  };
  const dispatch = async (planned: PlannedNotification[]): Promise<void> => {
    await dispatchPlanned(planned, {
      providers: runtime.providers,
      queue,
      recordDelivery: (record) => {
        deliverySink.recordDelivery?.(record);
      },
      now: () => runtime.clock.now(),
      resolveSound: (notification) => {
        const key = EVENT_CONFIG_KEYS[notification.eventType];
        const eventConfig = key === undefined ? undefined : runtime.config.events[key];
        return {
          soundId: eventConfig?.sound.soundId ?? "attention",
          volume: eventConfig?.sound.volume ?? 35,
        };
      },
      resolveSpeech: (notification) => ({
        text: notification.rendered?.speech ?? "",
        voiceId: runtime.config.voice.voiceId,
        volume: runtime.config.voice.volume,
        rate: runtime.config.voice.rate,
      }),
    });
  };

  const submitEvent = async (event: AgentEvent) => {
    const result = processEvent(event, {
      store: runtime.store,
      config: runtime.config,
      clock: runtime.clock,
      rateLimiter,
      quietHoursMinutes,
      grace,
    });

    if (result.status !== "rejected" && result.planned.length > 0) {
      void dispatch(result.planned).catch((error: unknown) => {
        writeDiagnostic(
          error instanceof Error ? `dispatch failed: ${error.message}` : "dispatch failed",
        );
      });
    }

    return result;
  };

  let readyForRequests = false;
  let lastActivityAt = runtime.clock.nowMs();
  let server: PipeServer | undefined;
  let stopping = false;
  let resolveStop: ((reason: string) => void) | undefined;
  const stopPromise = new Promise<string>((resolve) => {
    resolveStop = resolve;
  });

  const requestStop = (reason: string): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    resolveStop?.(reason);
  };

  const timers: TimerRegistry = createTimerRegistry({
    nowMs: () => runtime.clock.nowMs(),
    onFire: async (instruction) => {
      if (instruction.kind === "host_exit") {
        const nowMs = runtime.clock.nowMs();
        if (
          shouldExit({
            activeSessions: liveSessionCount(runtime),
            openConnections: server?.openConnections ?? 0,
            lastActivityAt,
            nowMs,
            idleMinutes,
          })
        ) {
          requestStop("idle");
        } else {
          refreshIdleTimer();
        }
        return;
      }

      await runtime.onTimer?.(instruction);
      refreshIdleTimer();
    },
  });

  const refreshIdleTimer = (): void => {
    if (noIdleExit || stopping) {
      return;
    }

    const openConnections = server?.openConnections ?? 0;
    const activeSessions = liveSessionCount(runtime);
    if (openConnections > 0 || activeSessions > 0) {
      timers.cancel("host_exit", HOST_TIMER_SESSION_KEY);
      return;
    }

    if (
      timers
        .pending()
        .some((timer) => timer.kind === "host_exit" && timer.sessionKey === HOST_TIMER_SESSION_KEY)
    ) {
      return;
    }

    timers.arm({
      kind: "host_exit",
      sessionKey: HOST_TIMER_SESSION_KEY,
      dueAt: new Date(runtime.clock.nowMs() + idleMinutes * MINUTE_MS).toISOString(),
    });
  };

  const markActivity = (): void => {
    lastActivityAt = runtime.clock.nowMs();
    if (!noIdleExit) {
      timers.cancel("host_exit", HOST_TIMER_SESSION_KEY);
    }
  };

  const onSignal = (): void => requestStop("signal");
  const onAbort = (): void => requestStop("abort");

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      requestStop("abort");
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  let idleInterval: NodeJS.Timeout | undefined;

  try {
    server = createPipeServer({
      pipeName,
      store: runtime.store,
      config: runtime.config,
      providers: runtime.providers,
      clock: runtime.clock,
      rateLimiter,
      grace,
      quietHoursMinutes,
      isReady: () => readyForRequests,
      ...(runtime.hardenPipeAcl === undefined ? {} : { hardenPipeAcl: runtime.hardenPipeAcl }),
      ...(runtime.history === undefined ? {} : { history: runtime.history }),
      ...(runtime.preview === undefined ? {} : { preview: runtime.preview }),
      ...(runtime.mute === undefined ? {} : { mute: runtime.mute }),
      ...(runtime.unmute === undefined ? {} : { unmute: runtime.unmute }),
      dispatch,
      onActivity: markActivity,
      onConnectionChange: () => {
        markActivity();
        refreshIdleTimer();
      },
      shutdown: () => {
        // Let the RPC response flush before the socket and pipe close.
        setImmediate(() => requestStop("rpc"));
      },
    });

    try {
      await server.ready;
    } catch (error) {
      if (error instanceof PipeServerError && error.code === "already_running") {
        writeDiagnostic(error.message);
        return 0;
      }
      throw error;
    }

    await runtime.migrate();

    if (!noIngest && spoolDir !== undefined) {
      const ingest = runtime.ingestSpool ?? ((dir: string) => ingestSpool(dir, submitEvent));
      await ingest(spoolDir);
    }

    const sessions = runtime.listSessions?.() ?? [];
    for (const session of reconcileSessions(sessions, runtime.clock.now())) {
      const previous = runtime.store.loadSession(session.adapterId, session.sessionId);
      if (
        previous === undefined ||
        previous.state !== session.state ||
        previous.stateConfidence !== session.stateConfidence
      ) {
        runtime.store.saveSession(session);
      }
    }

    readyForRequests = true;
    lastActivityAt = runtime.clock.nowMs();
    refreshIdleTimer();
    idleInterval = setInterval(refreshIdleTimer, idleCheckIntervalMs);
    idleInterval.unref();

    options.onReady?.(server);
    await stopPromise;
  } catch (error) {
    writeDiagnostic(error instanceof Error ? error.message : "host startup failed");
    requestStop("error");
    return 1;
  } finally {
    readyForRequests = false;
    if (idleInterval !== undefined) {
      clearInterval(idleInterval);
    }
    timers.dispose();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    options.signal?.removeEventListener("abort", onAbort);
    await server?.close();
    await closeRuntime(runtime);
  }

  return 0;
}
