import { configPath, readConfigFile, setConfigValue } from "../config-file";

function valueAt(root: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null || !(key in value)) throw new Error(`Unknown configuration key: ${path}`);
    return (value as Record<string, unknown>)[key];
  }, root);
}

export async function runConfig(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const path = configPath(env);
  const action = args[0] ?? "path";
  if (action === "path") return { path };
  if (action === "validate") {
    const result = await readConfigFile(path);
    return { valid: result.diagnostics.length === 0, diagnostics: result.diagnostics };
  }
  if (action === "get") {
    const key = args[1];
    if (key === undefined) throw new Error("config get requires a key path");
    const result = await readConfigFile(path);
    return { keyPath: key, value: valueAt(result.config, key) };
  }
  if (action === "set") {
    const key = args[1];
    const raw = args[2];
    if (key === undefined || raw === undefined) throw new Error("config set requires a key path and value");
    let value: unknown;
    try { value = JSON.parse(raw); } catch { value = raw; }
    const result = await setConfigValue(path, key, value);
    return { keyPath: key, value: valueAt(result.config, key) };
  }
  throw new Error(`unknown config action: ${action}`);
}
