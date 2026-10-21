import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../../packages/contract/src/config";
import { readConfigFile, setConfigValue, writeConfigFile } from "../../../packages/cli/src/config-file";

describe("config file", () => {
  it("writes atomically and preserves unknown top-level keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-attention-config-"));
    const path = join(dir, "config.json");
    try {
      await writeConfigFile(path, defaultConfig, { futureSetting: { enabled: true } });
      await setConfigValue(path, "events.completed.sound.volume", 12);
      const result = await readConfigFile(path);
      expect(result.config.events.completed.sound.volume).toBe(12);
      expect(result.unknownKeys).toEqual({ futureSetting: { enabled: true } });
      expect(JSON.parse(await readFile(path, "utf8")).futureSetting).toEqual({ enabled: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
