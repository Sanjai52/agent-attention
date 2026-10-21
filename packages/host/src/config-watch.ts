import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "jsonc-parser";
import { parseConfig, type AgentAttentionConfig, type ConfigDiagnostic } from "@agent-attention/contract";

export interface ReadConfigResult {
  raw: unknown;
  config: AgentAttentionConfig;
  diagnostics: ConfigDiagnostic[];
}

async function readConfigFile(path: string): Promise<ReadConfigResult> {
  let raw: unknown = {};
  try {
    raw = parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const result = parseConfig(raw);
  return { raw, config: result.config, diagnostics: result.diagnostics };
}

export interface ConfigWatcher {
  close(): void;
}

export function watchConfig(
  path: string,
  options: { debounceMs?: number; onChange: (result: ReadConfigResult) => void | Promise<void> },
): ConfigWatcher {
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  let watcher: FSWatcher | undefined;
  const refresh = (): void => {
    if (closed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      void readConfigFile(path).then(options.onChange).catch(() => undefined);
    }, options.debounceMs ?? 250);
  };
  void readConfigFile(path).then(options.onChange).catch(() => undefined);
  try {
    watcher = watch(path, refresh);
  } catch {
    // The file may not exist yet; the parent watcher is installed on demand.
    watcher = undefined;
  }
  return {
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      watcher?.close();
    },
  };
}
