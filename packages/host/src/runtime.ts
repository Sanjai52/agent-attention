/**
 * Production composition root for the Notification Host (Tasks 2.1–2.13).
 *
 * The store facade opens SQLite lazily so the named pipe is created first. This
 * preserves D-03's single-instance order: a second host loses the exclusive
 * pipe before it migrates or writes the database.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultConfig,
  type AgentAttentionConfig,
  type AgentEventType,
} from "@agent-attention/contract";
import type { Clock, PipelineStore, SessionRecord } from "@agent-attention/core";
import {
  DEFAULT_TOAST_APP_ID,
  createWindowsSoundProvider,
  createWindowsSpeechProvider,
  createWindowsToastProvider,
} from "@agent-attention/platform-windows";
import {
  createPipelineStore,
  openDatabase,
  type AgentAttentionStore,
  type DeliveryRecord,
  type EventFilters,
  type StoredEvent,
} from "@agent-attention/storage";

import type { HostRuntime } from "./lifecycle";

export interface DefaultRuntimeOptions {
  dataDir?: string;
  config?: AgentAttentionConfig;
  env?: NodeJS.ProcessEnv;
  /** Directory containing the committed fixed PowerShell scripts. */
  scriptsDir?: string;
}

/** `%LOCALAPPDATA%\\AgentAttention` on Windows. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(root, "AgentAttention");
}

interface StoreFacade extends PipelineStore {
  close(): void;
  listSessions(): SessionRecord[];
  listEvents(filters?: EventFilters): StoredEvent[];
  recordDelivery(record: DeliveryRecord): void;
}

export function createDefaultRuntime(options: DefaultRuntimeOptions = {}): HostRuntime {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? defaultDataDir(env);
  const config = options.config ?? structuredClone(defaultConfig);
  const platformRoot = fileURLToPath(
    new URL("../../platform-windows/", import.meta.url),
  );
  const scriptsDir = options.scriptsDir ?? join(platformRoot, "scripts");
  const soundsDir = join(platformRoot, "assets", "sounds");

  const clock: Clock = {
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };

  let store: AgentAttentionStore | undefined;
  const getStore = (): AgentAttentionStore => {
    if (store === undefined) {
      mkdirSync(dataDir, { recursive: true });
      const db = openDatabase(join(dataDir, "agent-attention.db"));
      store = createPipelineStore(db, {
        retentionDays: config.activityHistory.retentionDays,
      });
    }
    return store;
  };

  // A stable facade: property access does not open the database; the first
  // actual store operation does. Teardown can therefore close exactly what was
  // opened without creating a new connection.
  const storeFacade: StoreFacade = {
    claimFingerprint: (...args) => getStore().claimFingerprint(...args),
    claimEvent: (...args) => getStore().claimEvent(...args),
    recordEvent: (...args) => getStore().recordEvent(...args),
    loadSession: (...args) => getStore().loadSession(...args),
    saveSession: (...args) => getStore().saveSession(...args),
    recordDiagnostic: (...args) => getStore().recordDiagnostic(...args),
    recordDelivery: (record) => getStore().recordDelivery(record),
    listSessions: () => getStore().listSessions(),
    listEvents: (filters) => getStore().listEvents(filters),
    close: () => {
      if (store !== undefined) {
        store.close();
        store = undefined;
      }
    },
  };

  const providers = {
    sound: createWindowsSoundProvider({ scriptsDir, soundsDir }),
    voice: createWindowsSpeechProvider({
      scriptPath: join(scriptsDir, "speak.ps1"),
      voicesScriptPath: join(scriptsDir, "list-voices.ps1"),
    }),
    desktop: createWindowsToastProvider({
      appId: DEFAULT_TOAST_APP_ID,
      scriptPath: join(scriptsDir, "toast.ps1"),
    }),
  };

  return {
    store: storeFacade,
    config,
    providers,
    clock,
    migrate() {
      getStore();
    },
    listSessions() {
      return storeFacade.listSessions();
    },
    history(filters) {
      return storeFacade.listEvents({
        ...(filters.adapterId === undefined ? {} : { adapterId: filters.adapterId }),
        ...(filters.sessionId === undefined ? {} : { sessionId: filters.sessionId }),
        ...(filters.eventType === undefined
          ? {}
          : { eventType: filters.eventType as AgentEventType }),
        ...(filters.since === undefined ? {} : { from: filters.since }),
        ...(filters.until === undefined ? {} : { to: filters.until }),
        ...(filters.limit === undefined ? {} : { limit: filters.limit }),
      });
    },
    mute() {
      config.globalMute = true;
    },
    unmute() {
      config.globalMute = false;
    },
    shutdown() {
      storeFacade.close();
    },
  };
}
