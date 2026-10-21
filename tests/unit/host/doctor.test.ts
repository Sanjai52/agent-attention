import { AGENT_EVENT_TYPES, defaultConfig } from "@agent-attention/contract";
import type {
  AdapterCapabilities,
  AgentAttentionConfig,
  ConfigDiagnostic,
} from "@agent-attention/contract";
import type {
  DoctorDatabaseStore,
  DoctorDependencies,
  DoctorReport,
} from "@agent-attention/host";
import { collectDoctorReport } from "@agent-attention/host";
import { describe, expect, it, vi } from "vitest";

const PIPE_NAME = "\\\\.\\pipe\\agent-attention-u-doctor-test";
const DATABASE_PATH = "C:\\Users\\doctor-test\\AppData\\Local\\AgentAttention\\agent-attention.db";
const WINDOWS_VERSION = "Windows 11 Pro (10.0.26100)";

interface FakeStoreOptions {
  path?: string;
  schemaVersion?: number;
  probeOk?: boolean;
  schemaError?: boolean;
  prepareError?: boolean;
  pathError?: boolean;
}

function fakeStore(options: FakeStoreOptions = {}): DoctorDatabaseStore {
  const {
    path = DATABASE_PATH,
    schemaVersion = 3,
    probeOk = true,
    schemaError = false,
    prepareError = false,
    pathError = false,
  } = options;

  return {
    db: {
      get path() {
        if (pathError) {
          throw new Error("database connection is closed");
        }
        return path;
      },
      raw: {
        prepare(sql: string) {
          if (prepareError) {
            throw new Error("database connection is closed");
          }
          if (sql.includes("schema_migrations")) {
            if (schemaError) {
              throw new Error("no such table: schema_migrations");
            }
            return { get: () => ({ version: schemaVersion }) };
          }
          return { get: () => (probeOk ? { ok: 1 } : undefined) };
        },
      },
    },
  };
}

function config(): AgentAttentionConfig {
  return structuredClone(defaultConfig);
}

function makeDeps(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  return {
    config: config(),
    store: fakeStore(),
    pipe: { name: PIPE_NAME, reachable: true, pid: 4321 },
    providers: {},
    platform: {
      os: "win32",
      windowsVersion: WINDOWS_VERSION,
      host: "windows-terminal",
    },
    environment: {
      env: {},
      exists: () => false,
      readFile: () => undefined,
    },
    adapters: [],
    ...overrides,
  };
}

function capabilities(adapterId: string): AdapterCapabilities {
  const events = Object.fromEntries(
    AGENT_EVENT_TYPES.map((eventType) => [eventType, { support: "authoritative" }]),
  ) as AdapterCapabilities["events"];

  return {
    adapterId,
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

function expectedReport(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    windowsVersion: WINDOWS_VERSION,
    nodeVersion: process.version,
    host: { running: true, pid: 4321 },
    pipe: { name: PIPE_NAME, reachable: true },
    database: { schemaVersion: 3, healthy: true, path: DATABASE_PATH },
    config: { valid: true, diagnostics: [] },
    audio: { available: false },
    tts: { available: false, voices: [] },
    toast: { registered: false },
    focus: { supported: true },
    environment: { wsl: false, ssh: false, container: false },
    adapters: [],
    ...overrides,
  };
}

describe("collectDoctorReport", () => {
  it("returns the complete Phase 2 report for healthy dependencies", async () => {
    const report = await collectDoctorReport(
      makeDeps({
        providers: {
          sound: { available: true },
          voice: { available: true, voices: ["Microsoft Zira"] },
          desktop: { registered: true },
        },
      }),
    );

    expect(report).toEqual(
      expectedReport({
        audio: { available: true },
        tts: { available: true, voices: ["Microsoft Zira"] },
        toast: { registered: true },
      }),
    );
    expect(report.nodeVersion).toBe(process.version);
    // A toast is submitted, never "seen" (F6-R10).
    expect(report.toast).not.toHaveProperty("seen");
  });

  it("awaits provider probes and enumerates TTS voices without speaking", async () => {
    const soundProbe = vi.fn(async () => true);
    const voiceProbe = vi.fn(async () => true);
    const listVoices = vi.fn(async () => ["Voice A", { name: "Voice B" }]);
    const isRegistered = vi.fn(async () => true);

    const report = await collectDoctorReport(
      makeDeps({
        providers: {
          sound: { probe: soundProbe },
          voice: { probe: voiceProbe, listVoices },
          desktop: { isRegistered },
        },
      }),
    );

    expect(soundProbe).toHaveBeenCalledTimes(1);
    expect(voiceProbe).toHaveBeenCalledTimes(1);
    expect(listVoices).toHaveBeenCalledTimes(1);
    expect(isRegistered).toHaveBeenCalledTimes(1);
    expect(report.audio.available).toBe(true);
    expect(report.tts).toEqual({ available: true, voices: ["Voice A", "Voice B"] });
    expect(report.toast.registered).toBe(true);
  });

  it("reports absent providers as unavailable instead of guessing", async () => {
    const report = await collectDoctorReport(makeDeps());

    expect(report.audio).toEqual({ available: false });
    expect(report.tts).toEqual({ available: false, voices: [] });
    expect(report.toast).toEqual({ registered: false });
  });

  it("accepts a generic projection probe for toast registration", async () => {
    const desktopProbe = vi.fn(async () => true);
    const report = await collectDoctorReport(
      makeDeps({ providers: { desktop: { probe: desktopProbe } } }),
    );

    expect(desktopProbe).toHaveBeenCalledTimes(1);
    expect(report.toast.registered).toBe(true);
  });

  it("reports a stopped host and omits the PID when the pipe is unreachable", async () => {
    const report = await collectDoctorReport(
      makeDeps({ pipe: { name: PIPE_NAME, reachable: false, pid: 9999 } }),
    );

    expect(report.host).toEqual({ running: false });
    expect(report.host).not.toHaveProperty("pid");
    expect(report.pipe).toEqual({ name: PIPE_NAME, reachable: false });
  });

  it("marks the config invalid and returns diagnostics verbatim", async () => {
    const diagnostics: ConfigDiagnostic[] = [
      {
        keyPath: "voice.volume",
        code: "invalid_value",
        message: "expected number",
        appliedFallback: 50,
      },
      {
        keyPath: "unknownKey",
        code: "unknown_key",
        message: "unknown configuration key",
        appliedFallback: undefined,
      },
    ];

    const report = await collectDoctorReport(
      makeDeps({ configDiagnostics: diagnostics }),
    );

    expect(report.config.valid).toBe(false);
    expect(report.config.diagnostics).toEqual(diagnostics);
  });

  it("keeps the report valid when config diagnostics are explicitly empty", async () => {
    const report = await collectDoctorReport(makeDeps({ configDiagnostics: [] }));

    expect(report.config).toEqual({ valid: true, diagnostics: [] });
  });

  it.each([
    ["the SELECT 1 probe returns no row", { probeOk: false }],
    ["the schema_migrations query fails", { schemaError: true }],
    ["the database handle is closed", { prepareError: true }],
  ])("reports an unhealthy database when %s", async (_label, storeOptions) => {
    const report = await collectDoctorReport(
      makeDeps({ store: fakeStore(storeOptions) }),
    );

    expect(report.database).toEqual({ schemaVersion: 0, healthy: false, path: DATABASE_PATH });
  });

  it("prefers an explicit database path and survives an unreadable store path", async () => {
    const report = await collectDoctorReport(
      makeDeps({
        store: fakeStore({ pathError: true }),
        databasePath: "D:\\agent-attention\\agent-attention.db",
      }),
    );

    expect(report.database).toEqual({
      schemaVersion: 3,
      healthy: true,
      path: "D:\\agent-attention\\agent-attention.db",
    });
  });

  it("reports an empty path when neither the store nor the caller supplies one", async () => {
    const report = await collectDoctorReport(makeDeps({ store: fakeStore({ pathError: true }) }));

    expect(report.database.path).toBe("");
  });

  it("falls back to store-provided database facts when no SQL handle is exposed", async () => {
    const report = await collectDoctorReport(
      makeDeps({
        store: {
          databasePath: "E:\\agent-attention\\agent-attention.db",
          schemaVersion: async () => 4,
          healthy: () => true,
        },
      }),
    );

    expect(report.database).toEqual({
      schemaVersion: 4,
      healthy: true,
      path: "E:\\agent-attention\\agent-attention.db",
    });
  });

  it("reports an unhealthy database when fallback probes fail", async () => {
    const report = await collectDoctorReport(
      makeDeps({
        store: {
          schemaVersion: () => {
            throw new Error("store closed");
          },
          healthy: true,
        },
      }),
    );

    expect(report.database).toEqual({ schemaVersion: 0, healthy: false, path: "" });
  });

  it("fails provider checks independently and never throws", async () => {
    const report = await collectDoctorReport(
      makeDeps({
        providers: {
          sound: {
            probe: async () => {
              throw new Error("no audio device");
            },
          },
          voice: {
            probe: async () => false,
            listVoices: async () => {
              throw new Error("SAPI unavailable");
            },
          },
          desktop: {
            isRegistered: async () => {
              throw new Error("registration check failed");
            },
          },
        },
      }),
    );

    expect(report.audio).toEqual({ available: false });
    expect(report.tts).toEqual({ available: false, voices: [] });
    expect(report.toast).toEqual({ registered: false });
  });

  it("derives TTS availability from the installed voice list when no probe is supplied", async () => {
    const listed = await collectDoctorReport(
      makeDeps({
        providers: {
          voice: { listVoices: async () => [{ name: "Microsoft David" }] },
        },
      }),
    );
    expect(listed.tts).toEqual({ available: true, voices: ["Microsoft David"] });

    const staticVoices = await collectDoctorReport(
      makeDeps({ providers: { voice: { voices: ["Static Voice"] } } }),
    );
    expect(staticVoices.tts).toEqual({ available: true, voices: ["Static Voice"] });
  });

  it("never reports voices when TTS is explicitly unavailable", async () => {
    const report = await collectDoctorReport(
      makeDeps({
        providers: {
          voice: { available: false, voices: ["Installed But Disabled"] },
        },
      }),
    );

    expect(report.tts).toEqual({ available: false, voices: [] });
  });

  it.each([
    ["windows-terminal", true],
    ["classic-console", true],
    ["vscode", false],
    ["unknown", false],
    [undefined, false],
  ] as const)("reports focus support for %s as %s (Q-06)", async (host, supported) => {
    const report = await collectDoctorReport(
      makeDeps({
        platform: {
          os: "win32",
          windowsVersion: WINDOWS_VERSION,
          ...(host === undefined ? {} : { host }),
        },
      }),
    );

    expect(report.focus.supported).toBe(supported);
  });

  it("never reports focus support off Windows or when the caller marks it unsupported", async () => {
    const nonWindows = await collectDoctorReport(
      makeDeps({
        platform: {
          os: "linux",
          windowsVersion: WINDOWS_VERSION,
          host: "windows-terminal",
          focusSupported: true,
        },
      }),
    );
    expect(nonWindows.focus.supported).toBe(false);

    const disabled = await collectDoctorReport(
      makeDeps({
        platform: {
          os: "win32",
          windowsVersion: WINDOWS_VERSION,
          host: "windows-terminal",
          focusSupported: false,
        },
      }),
    );
    expect(disabled.focus.supported).toBe(false);
  });

  it("uses a neutral Windows version off Windows and never reads the host OS", async () => {
    const report = await collectDoctorReport(
      makeDeps({
        platform: {
          os: "linux",
          windowsVersion: WINDOWS_VERSION,
          host: "windows-terminal",
        },
      }),
    );

    expect(report.windowsVersion).toBe("not-windows");
  });

  it("uses the injected Windows version on win32", async () => {
    const report = await collectDoctorReport(
      makeDeps({
        platform: {
          os: "win32",
          windowsVersion: "Windows 10 Enterprise (10.0.19045)",
          host: "classic-console",
        },
      }),
    );

    expect(report.windowsVersion).toBe("Windows 10 Enterprise (10.0.19045)");
  });

  it("detects WSL from WSL_DISTRO_NAME or the Microsoft marker in /proc/version", async () => {
    const fromEnv = await collectDoctorReport(
      makeDeps({
        environment: {
          env: { WSL_DISTRO_NAME: "Ubuntu-24.04" },
          exists: () => false,
          readFile: () => undefined,
        },
      }),
    );
    expect(fromEnv.environment.wsl).toBe(true);

    const fromProc = await collectDoctorReport(
      makeDeps({
        environment: {
          env: {},
          exists: () => false,
          readFile: (path) =>
            path === "/proc/version"
              ? "Linux version 6.6.87.2-microsoft-standard-WSL2 (root@build)"
              : undefined,
        },
      }),
    );
    expect(fromProc.environment.wsl).toBe(true);
  });

  it("detects SSH from SSH_CONNECTION or SSH_CLIENT", async () => {
    for (const env of [
      { SSH_CONNECTION: "203.0.113.10 51422 198.51.100.5 22" },
      { SSH_CLIENT: "203.0.113.10 51422 22" },
    ]) {
      const report = await collectDoctorReport(
        makeDeps({
          environment: { env, exists: () => false, readFile: () => undefined },
        }),
      );
      expect(report.environment.ssh).toBe(true);
    }
  });

  it("detects containers from sentinel files and the Kubernetes environment", async () => {
    const fromDocker = await collectDoctorReport(
      makeDeps({
        environment: {
          env: {},
          exists: (path) => path === "/.dockerenv",
          readFile: () => undefined,
        },
      }),
    );
    expect(fromDocker.environment.container).toBe(true);

    const fromRun = await collectDoctorReport(
      makeDeps({
        environment: {
          env: {},
          exists: (path) => path === "/run/.containerenv",
          readFile: () => undefined,
        },
      }),
    );
    expect(fromRun.environment.container).toBe(true);

    const fromKubernetes = await collectDoctorReport(
      makeDeps({
        environment: {
          env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" },
          exists: () => false,
          readFile: () => undefined,
        },
      }),
    );
    expect(fromKubernetes.environment.container).toBe(true);
  });

  it("returns adapter capabilities unchanged and copies the array", async () => {
    const adapters = [capabilities("adapter-a"), capabilities("adapter-b")];
    const report = await collectDoctorReport(makeDeps({ adapters }));

    expect(report.adapters).toEqual(adapters);
    expect(report.adapters).not.toBe(adapters);
  });
});
