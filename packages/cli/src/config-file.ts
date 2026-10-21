import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse } from "jsonc-parser";
import {
  defaultConfig,
  parseConfig,
  type AgentAttentionConfig,
  type ConfigDiagnostic,
} from "@agent-attention/contract";

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const appData = env.APPDATA;
  if (appData !== undefined && appData.length > 0) return join(appData, "AgentAttention", "config.json");
  const home = env.USERPROFILE ?? env.HOME ?? ".";
  return join(home, "AppData", "Roaming", "AgentAttention", "config.json");
}

export interface ReadConfigResult {
  raw: unknown;
  config: AgentAttentionConfig;
  diagnostics: ConfigDiagnostic[];
  unknownKeys: Record<string, unknown>;
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "{}";
    throw error;
  }
}

export async function readConfigFile(path: string): Promise<ReadConfigResult> {
  const text = await readText(path);
  const raw = parse(text);
  const validated = parseConfig(raw);
  const known = new Set(Object.keys(defaultConfig));
  const unknownKeys = Object.fromEntries(
    Object.entries(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {})
      .filter(([key]) => !known.has(key)),
  );
  return { raw, config: validated.config, diagnostics: validated.diagnostics, unknownKeys };
}

export async function writeConfigFile(
  path: string,
  config: AgentAttentionConfig,
  unknownKeys: Record<string, unknown> = {},
): Promise<void> {
  const merged = { ...unknownKeys, ...config };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export async function setConfigValue(
  path: string,
  keyPath: string,
  value: unknown,
): Promise<ReadConfigResult> {
  const current = await readConfigFile(path);
  const updated = structuredClone(current.config) as Record<string, unknown>;
  const segments = keyPath.split(".").filter(Boolean);
  let cursor: Record<string, unknown> = updated;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      throw new Error(`Unknown configuration key: ${keyPath}`);
    }
    cursor = next as Record<string, unknown>;
  }
  const leaf = segments.at(-1);
  if (leaf === undefined) throw new Error("Configuration key is required");
  cursor[leaf] = value;
  const validated = parseConfig(updated);
  if (validated.diagnostics.length > 0) {
    throw new Error(validated.diagnostics.map((item) => `${item.keyPath}: ${item.message}`).join("; "));
  }
  await writeConfigFile(path, validated.config, current.unknownKeys);
  return { raw: updated, config: validated.config, diagnostics: [], unknownKeys: current.unknownKeys };
}
