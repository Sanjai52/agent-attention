import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOAST_APP_ID,
  isRegistered,
  registerToastIdentity,
  toastShortcutName,
  unregisterToastIdentity,
} from "@agent-attention/platform-windows";
import { createFakeRunner, scriptResult } from "./fake-runner";

const SCRIPT_PATH = "C:\\app\\scripts\\toast.ps1";
const APP_ID = "AgentAttention.Test";
const REGISTRY_KEY = `HKCU:\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
const SHORTCUT_PATH = `C:\\Users\\test\\Start Menu\\Programs\\${toastShortcutName(APP_ID)}.lnk`;

function argValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

interface RegistrationState {
  registryKeyExists: boolean;
  shortcutExists: boolean;
  displayName: string;
  appSettingsKeyExists: boolean;
}

function createStatefulToastRunner(initial: RegistrationState) {
  const state = { ...initial };
  const runner = createFakeRunner((options) => {
    const mode = argValue(options.args, "-Mode");
    if (mode === "status") {
      return scriptResult({
        stdout: JSON.stringify({
          registryKeyExists: state.registryKeyExists,
          shortcutExists: state.shortcutExists,
          registered: state.registryKeyExists && state.shortcutExists,
          displayName: state.displayName,
          registryKey: REGISTRY_KEY,
          shortcutPath: SHORTCUT_PATH,
        }),
      });
    }
    if (mode === "register") {
      const created: string[] = [];
      if (!state.registryKeyExists) created.push(REGISTRY_KEY);
      if (!state.shortcutExists) created.push(SHORTCUT_PATH);
      state.registryKeyExists = true;
      state.shortcutExists = true;
      state.displayName = argValue(options.args, "-DisplayName") ?? "";
      return scriptResult({
        stdout: JSON.stringify({
          created,
          registered: true,
          registryKey: REGISTRY_KEY,
          shortcutPath: SHORTCUT_PATH,
        }),
      });
    }
    if (mode === "unregister") {
      const removed: string[] = [];
      if (state.registryKeyExists) removed.push(REGISTRY_KEY);
      if (state.shortcutExists) removed.push(SHORTCUT_PATH);
      if (state.appSettingsKeyExists) removed.push("app-settings");
      state.registryKeyExists = false;
      state.shortcutExists = false;
      state.appSettingsKeyExists = false;
      return scriptResult({
        stdout: JSON.stringify({ removed, registered: false }),
      });
    }
    return scriptResult({ code: 2, stderr: `unknown mode: ${mode ?? "(none)"}` });
  });
  return { state, runner };
}

describe("toastShortcutName", () => {
  it("uses a stable Start Menu name for the default identity", () => {
    expect(toastShortcutName(DEFAULT_TOAST_APP_ID)).toBe("Agent Attention");
  });

  it("derives a stable, app-specific name for other identities", () => {
    expect(toastShortcutName("AgentAttention.Test")).toBe(
      "Agent Attention (AgentAttention.Test)",
    );
  });
});

describe("registerToastIdentity", () => {
  it("rejects an app id with unsafe characters before invoking PowerShell", async () => {
    const runner = createFakeRunner();

    await expect(
      registerToastIdentity({
        appId: "..\\evil $(calc)",
        displayName: "Agent Attention",
        scriptPath: SCRIPT_PATH,
        runScript: runner.run,
      }),
    ).rejects.toThrow(TypeError);
    expect(runner.calls).toHaveLength(0);
  });

  it("rejects a display name containing control characters", async () => {
    const runner = createFakeRunner();

    await expect(
      registerToastIdentity({
        appId: APP_ID,
        displayName: "Agent\u0007Attention",
        scriptPath: SCRIPT_PATH,
        runScript: runner.run,
      }),
    ).rejects.toThrow(TypeError);
    expect(runner.calls).toHaveLength(0);
  });

  it("creates the per-user identity and returns exactly what it created", async () => {
    const { runner } = createStatefulToastRunner({
      registryKeyExists: false,
      shortcutExists: false,
      displayName: "",
      appSettingsKeyExists: false,
    });

    const result = await registerToastIdentity({
      appId: APP_ID,
      displayName: "Agent Attention",
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    expect(result).toEqual({ created: [REGISTRY_KEY, SHORTCUT_PATH] });
    const call = runner.calls[0]!;
    expect(call.options.scriptPath).toBe(SCRIPT_PATH);
    expect(call.options.args).toEqual([
      "-Mode",
      "register",
      "-Aumid",
      APP_ID,
      "-DisplayName",
      "Agent Attention",
      "-ShortcutName",
      toastShortcutName(APP_ID),
    ]);
  });

  it("is idempotent: a second registration creates nothing", async () => {
    const { runner } = createStatefulToastRunner({
      registryKeyExists: true,
      shortcutExists: true,
      displayName: "Agent Attention",
      appSettingsKeyExists: true,
    });

    await expect(
      registerToastIdentity({
        appId: APP_ID,
        displayName: "Agent Attention",
        scriptPath: SCRIPT_PATH,
        runScript: runner.run,
      }),
    ).resolves.toEqual({ created: [] });
  });

  it("throws a useful error when the fixed script fails", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: 2, stderr: "REGISTER_FAILED: access denied" }),
    );

    await expect(
      registerToastIdentity({
        appId: APP_ID,
        displayName: "Agent Attention",
        scriptPath: SCRIPT_PATH,
        runScript: runner.run,
      }),
    ).rejects.toThrow("REGISTER_FAILED: access denied");
  });
});

describe("isRegistered", () => {
  it("is false when the registry key and shortcut are absent", async () => {
    const { runner } = createStatefulToastRunner({
      registryKeyExists: false,
      shortcutExists: false,
      displayName: "",
      appSettingsKeyExists: false,
    });

    await expect(
      isRegistered(APP_ID, { scriptPath: SCRIPT_PATH, runScript: runner.run }),
    ).resolves.toBe(false);
  });

  it("requires both the registry key and the shortcut", async () => {
    const registryOnly = createStatefulToastRunner({
      registryKeyExists: true,
      shortcutExists: false,
      displayName: "Agent Attention",
      appSettingsKeyExists: false,
    });
    const shortcutOnly = createStatefulToastRunner({
      registryKeyExists: false,
      shortcutExists: true,
      displayName: "Agent Attention",
      appSettingsKeyExists: false,
    });

    await expect(
      isRegistered(APP_ID, {
        scriptPath: SCRIPT_PATH,
        runScript: registryOnly.runner.run,
      }),
    ).resolves.toBe(false);
    await expect(
      isRegistered(APP_ID, {
        scriptPath: SCRIPT_PATH,
        runScript: shortcutOnly.runner.run,
      }),
    ).resolves.toBe(false);
  });

  it("is true after registration", async () => {
    const { runner } = createStatefulToastRunner({
      registryKeyExists: false,
      shortcutExists: false,
      displayName: "",
      appSettingsKeyExists: false,
    });
    await registerToastIdentity({
      appId: APP_ID,
      displayName: "Agent Attention",
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(
      isRegistered(APP_ID, { scriptPath: SCRIPT_PATH, runScript: runner.run }),
    ).resolves.toBe(true);
  });

  it("returns false instead of throwing when the helper is unavailable", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: -1, spawnError: "spawn powershell.exe ENOENT" }),
    );

    await expect(
      isRegistered(APP_ID, { scriptPath: SCRIPT_PATH, runScript: runner.run }),
    ).resolves.toBe(false);
  });
});

describe("unregisterToastIdentity", () => {
  it("removes the identity and is idempotent", async () => {
    const { state, runner } = createStatefulToastRunner({
      registryKeyExists: true,
      shortcutExists: true,
      displayName: "Agent Attention",
      appSettingsKeyExists: true,
    });

    await unregisterToastIdentity(APP_ID, {
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });
    expect(state.registryKeyExists).toBe(false);
    expect(state.shortcutExists).toBe(false);
    expect(state.appSettingsKeyExists).toBe(false);

    await expect(
      unregisterToastIdentity(APP_ID, {
        scriptPath: SCRIPT_PATH,
        runScript: runner.run,
      }),
    ).resolves.toBeUndefined();

    const unregisterCalls = runner.calls.filter(
      (call) => argValue(call.options.args, "-Mode") === "unregister",
    );
    expect(unregisterCalls).toHaveLength(2);
  });

  it("throws when the fixed script fails", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: 2, stderr: "UNREGISTER_FAILED" }),
    );

    await expect(
      unregisterToastIdentity(APP_ID, {
        scriptPath: SCRIPT_PATH,
        runScript: runner.run,
      }),
    ).rejects.toThrow("UNREGISTER_FAILED");
  });
});
