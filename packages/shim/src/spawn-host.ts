/**
 * Detached, hidden Notification Host spawn for the shim (PRD.md §9.2).
 *
 * S2-07 measured that `detached: true, windowsHide: true, stdio: "ignore"`
 * gives the host no console at all. The shim never waits for this child; it
 * only starts it and then runs its one bounded retry phase.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export interface SpawnHostOptions {
  entry?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface SpawnHostResult {
  spawned: boolean;
  pid?: number;
}

/**
 * OpenCode plugins run under Bun, whose `process.execPath` is the OpenCode
 * executable rather than a JavaScript runtime. Launching the Node host with
 * that path makes OpenCode treat `main.js` as a working directory. Prefer an
 * explicit override, then fall back to the Node executable on Windows/Bun.
 */
export function resolveHostRuntime(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AGENT_ATTENTION_NODE_EXECUTABLE?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }

  const executable = process.execPath.toLowerCase();
  if (executable.endsWith("\\bun.exe") || executable.endsWith("/bun") || executable.endsWith("\\opencode.exe") || executable.endsWith("/opencode")) {
    return process.platform === "win32" ? "node.exe" : "node";
  }

  return process.execPath;
}

/**
 * Locate the built host entry. `AGENT_ATTENTION_HOST_ENTRY` wins so adapters
 * and tests can point at a development or packaged entry explicitly.
 */
export function resolveHostEntry(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.AGENT_ATTENTION_HOST_ENTRY?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }

  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve("@agent-attention/host/package.json");
    const distEntry = join(dirname(packageJson), "dist", "main.js");
    if (existsSync(distEntry)) {
      return distEntry;
    }
  } catch {
    // The host package may not be installed in a partial development tree.
  }

  return undefined;
}

/**
 * Spawn the host detached and hidden, then unref it. Returns `spawned: false`
 * when no host entry is available; the caller then falls through to the spool.
 */
export function spawnHostDetached(options: SpawnHostOptions = {}): SpawnHostResult {
  const entry = options.entry ?? resolveHostEntry();
  if (entry === undefined) {
    return { spawned: false };
  }

  const child = spawn(resolveHostRuntime(options.env), [entry, ...(options.args ?? [])], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    ...(options.env === undefined
      ? {}
      : { env: { ...process.env, ...options.env } }),
  });
  child.unref();

  return {
    spawned: true,
    ...(child.pid === undefined ? {} : { pid: child.pid }),
  };
}
