/**
 * `doctor` data collection (PRD.md F11-R1, AC-F11-02, AC-F6-07, AC-F13-05).
 *
 * This module only gathers facts. It never plays audio, speaks, shows a toast,
 * or changes configuration. Every provider probe is best-effort: a failed or
 * unavailable provider becomes `false`/an empty list instead of an error, so a
 * doctor run cannot be derailed by one broken subsystem.
 *
 * The environment checks are detection only (D-09). They mark WSL, SSH, and
 * container sessions so the CLI can explain the limitation; they never refuse
 * to run.
 */

import { existsSync, readFileSync } from "node:fs";
import { release as osRelease, version as osVersion } from "node:os";

import type {
  AdapterCapabilities,
  AgentAttentionConfig,
  ConfigDiagnostic,
} from "@agent-attention/contract";

/** Sentinel returned for `windowsVersion` when the host is not Windows. */
export const NON_WINDOWS_VERSION = "not-windows";

/** Host surfaces with a session-to-window mapping (PRD Q-06, F13-R5). */
export type DoctorFocusHost = "windows-terminal" | "classic-console" | "vscode" | "unknown";

export interface DoctorPipeStatus {
  /** Full pipe name, including the `\\.\pipe\` prefix when available. */
  name: string;
  reachable: boolean;
  /** PID of the answering host, when the caller learned it from a ping. */
  pid?: number;
}

/**
 * Structural subset of the storage store used by doctor. The real
 * `AgentAttentionStore` satisfies it through its `db` handle.
 */
export interface DoctorDatabaseStore {
  readonly db?: {
    readonly path: string;
    readonly raw: {
      prepare(sql: string): { get(): unknown };
    };
  };
  /** Doctor-only fallback for stores that hide their SQL handle. */
  readonly databasePath?: string;
  readonly schemaVersion?: number | (() => number | Promise<number>);
  readonly healthy?: boolean | (() => boolean | Promise<boolean>);
}

export interface DoctorSoundProbe {
  /** Last known capability, when a caller already probed the device. */
  available?: boolean;
  probe?(): boolean | Promise<boolean>;
}

export interface DoctorSpeechProbe {
  available?: boolean;
  voices?: readonly (string | { name: string })[];
  listVoices?():
    | Promise<readonly (string | { name: string })[]>
    | readonly (string | { name: string })[];
  probe?(): boolean | Promise<boolean>;
}

export interface DoctorDesktopProbe {
  /** Registration state, when a caller already checked it. */
  registered?: boolean;
  isRegistered?(): boolean | Promise<boolean>;
  probe?(): boolean | Promise<boolean>;
}

/**
 * Provider subset for doctor. Concrete providers may expose a probe or a
 * cached capability; plain `ProviderSet` implementations still type-check but
 * report `false` until a probe is supplied.
 */
export interface DoctorProviders {
  sound?: DoctorSoundProbe;
  voice?: DoctorSpeechProbe;
  desktop?: DoctorDesktopProbe;
}

export interface DoctorPlatform {
  /** Defaults to `process.platform`. */
  os?: NodeJS.Platform;
  /** Windows version override; otherwise derived from `os.version()`/`os.release()`. */
  windowsVersion?: string;
  /** Session host surface; focus is supported only for WT/classic console (Q-06). */
  host?: DoctorFocusHost;
  /** Explicit capability override; ignored off Windows. */
  focusSupported?: boolean;
}

export interface DoctorEnvironmentSources {
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to `fs.existsSync`; injectable for tests. */
  exists?: (path: string) => boolean;
  /** Defaults to `fs.readFileSync`; injectable for tests. */
  readFile?: (path: string) => string | undefined;
}

export interface DoctorDependencies {
  config: AgentAttentionConfig;
  /** Diagnostics produced when the config file was parsed (PRD §8.1). */
  configDiagnostics?: readonly ConfigDiagnostic[];
  store: DoctorDatabaseStore;
  pipe: DoctorPipeStatus;
  providers?: DoctorProviders;
  platform?: DoctorPlatform;
  environment?: DoctorEnvironmentSources;
  /** Overrides `store.db.path` when a caller already resolved the file. */
  databasePath?: string;
  /** Capability declarations for every registered adapter. */
  adapters?: readonly AdapterCapabilities[];
}

export interface DoctorReport {
  windowsVersion: string;
  nodeVersion: string;
  host: { running: boolean; pid?: number };
  pipe: { name: string; reachable: boolean };
  database: { schemaVersion: number; healthy: boolean; path: string };
  config: { valid: boolean; diagnostics: ConfigDiagnostic[] };
  audio: { available: boolean };
  tts: { available: boolean; voices: string[] };
  toast: { registered: boolean };
  focus: { supported: boolean };
  environment: { wsl: boolean; ssh: boolean; container: boolean };
  adapters: AdapterCapabilities[];
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function safeExists(
  exists: (path: string) => boolean,
  path: string,
): boolean {
  try {
    return exists(path) === true;
  } catch {
    return false;
  }
}

function safeReadFile(
  readFile: (path: string) => string | undefined,
  path: string,
): string | undefined {
  try {
    const contents = readFile(path);
    return typeof contents === "string" ? contents : undefined;
  } catch {
    return undefined;
  }
}

/** Detection only; never rejects or blocks a run (D-09). */
export function detectEnvironment(
  sources: DoctorEnvironmentSources = {},
): DoctorReport["environment"] {
  const env = sources.env ?? process.env;
  const exists = sources.exists ?? ((path: string) => existsSync(path));
  const readFile =
    sources.readFile ??
    ((path: string) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    });

  const procVersion = safeReadFile(readFile, "/proc/version");

  return {
    wsl:
      nonEmpty(env.WSL_DISTRO_NAME) ||
      (procVersion?.toLowerCase().includes("microsoft") ?? false),
    ssh: nonEmpty(env.SSH_CONNECTION) || nonEmpty(env.SSH_CLIENT),
    container:
      safeExists(exists, "/.dockerenv") ||
      safeExists(exists, "/run/.containerenv") ||
      nonEmpty(env.KUBERNETES_SERVICE_HOST),
  };
}

function windowsVersionFor(platform: DoctorPlatform): string {
  if (platform.os !== "win32") {
    return NON_WINDOWS_VERSION;
  }

  const override = platform.windowsVersion;
  if (override !== undefined && nonEmpty(override)) {
    return override;
  }

  const version = osVersion();
  const release = osRelease();
  if (version !== "" && release !== "") {
    return `${version} (${release})`;
  }
  return version !== "" ? version : release !== "" ? release : "unknown";
}

function focusSupportedFor(platform: DoctorPlatform): boolean {
  if (platform.os !== "win32") {
    return false;
  }
  if (platform.focusSupported !== undefined) {
    return platform.focusSupported;
  }
  // VS Code and unknown hosts are unsupported: their extension APIs expose no
  // session-to-window mapping, and PID-only matching produced false positives.
  return platform.host === "windows-terminal" || platform.host === "classic-console";
}

function readStorePath(store: DoctorDatabaseStore): string {
  try {
    if (typeof store.databasePath === "string") {
      return store.databasePath;
    }
    return typeof store.db?.path === "string" ? store.db.path : "";
  } catch {
    return "";
  }
}

async function readStoreFact<T>(
  value: T | (() => T | Promise<T>) | undefined,
): Promise<T | undefined> {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : value;
}

async function inspectDatabase(
  store: DoctorDatabaseStore,
  explicitPath: string | undefined,
): Promise<DoctorReport["database"]> {
  const path = explicitPath ?? readStorePath(store);
  const db = store.db;

  try {
    if (db !== undefined) {
      const probe = db.raw.prepare("SELECT 1 AS ok").get() as
        | { ok?: unknown }
        | undefined;

      if (probe === undefined || Number(probe.ok) !== 1) {
        return { schemaVersion: 0, healthy: false, path };
      }

      const row = db.raw
        .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
        .get() as { version?: unknown } | undefined;
      const schemaVersion = Number(row?.version ?? 0);

      if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
        return { schemaVersion: 0, healthy: false, path };
      }

      return { schemaVersion, healthy: true, path };
    }

    const reportedVersion = Number((await readStoreFact(store.schemaVersion)) ?? 0);
    const schemaVersion =
      Number.isInteger(reportedVersion) && reportedVersion >= 0 ? reportedVersion : 0;
    const healthy = (await readStoreFact(store.healthy)) === true;

    return { schemaVersion, healthy, path };
  } catch {
    return { schemaVersion: 0, healthy: false, path };
  }
}

async function probeBoolean(
  probe: (() => boolean | Promise<boolean>) | undefined,
  fallback: boolean | undefined,
): Promise<boolean> {
  if (probe !== undefined) {
    try {
      return (await probe()) === true;
    } catch {
      return false;
    }
  }
  return fallback === true;
}

function normalizeVoices(
  entries: readonly (string | { name: string })[],
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    if (typeof name !== "string" || name.trim() === "" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names;
}

async function inspectTts(
  voice: DoctorSpeechProbe | undefined,
): Promise<DoctorReport["tts"]> {
  let voices: string[] = [];

  if (voice?.listVoices !== undefined) {
    try {
      voices = normalizeVoices(await voice.listVoices());
    } catch {
      voices = [];
    }
  } else if (voice?.voices !== undefined) {
    voices = normalizeVoices(voice.voices);
  }

  let available: boolean;
  if (voice?.probe !== undefined) {
    available = await probeBoolean(() => voice.probe?.() ?? false, voice.available);
  } else if (voice?.available !== undefined) {
    available = voice.available;
  } else {
    available = voices.length > 0;
  }

  return { available, voices: available ? voices : [] };
}

/**
 * Collect one doctor report. Pure with respect to the host: no provider is
 * invoked to play/speak/show, and no state is mutated.
 */
export async function collectDoctorReport(
  deps: DoctorDependencies,
): Promise<DoctorReport> {
  const platform: DoctorPlatform = deps.platform ?? {};
  const os = platform.os ?? process.platform;
  const resolvedPlatform = { ...platform, os };
  const pipe = deps.pipe;
  const sound = deps.providers?.sound;
  const desktop = deps.providers?.desktop;

  const audioAvailable = await probeBoolean(
    sound?.probe === undefined ? undefined : () => sound.probe?.() ?? false,
    sound?.available,
  );
  const tts = await inspectTts(deps.providers?.voice);
  const registrationProbe =
    desktop?.isRegistered !== undefined
      ? () => desktop.isRegistered?.() ?? false
      : desktop?.probe === undefined
        ? undefined
        : () => desktop.probe?.() ?? false;
  const toastRegistered = await probeBoolean(registrationProbe, desktop?.registered);

  const diagnostics =
    deps.configDiagnostics === undefined ? [] : [...deps.configDiagnostics];

  return {
    windowsVersion: windowsVersionFor(resolvedPlatform),
    nodeVersion: process.version,
    host: {
      running: pipe.reachable,
      ...(pipe.reachable && pipe.pid !== undefined ? { pid: pipe.pid } : {}),
    },
    pipe: { name: pipe.name, reachable: pipe.reachable },
    database: await inspectDatabase(deps.store, deps.databasePath),
    config: { valid: diagnostics.length === 0, diagnostics },
    audio: { available: audioAvailable },
    tts,
    toast: { registered: toastRegistered },
    focus: { supported: focusSupportedFor(resolvedPlatform) },
    environment: detectEnvironment(deps.environment),
    adapters: deps.adapters === undefined ? [] : [...deps.adapters],
  };
}
