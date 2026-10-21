import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../../packages/cli/src/main";

function capture() {
  let stdout = "";
  let stderr = "";
  return { io: { stdout: { write(value: string) { stdout += value; } }, stderr: { write(value: string) { stderr += value; } } }, output: () => ({ stdout, stderr }) };
}

describe("Claude Code installer CLI", () => {
  it("installs and uninstalls through the host-specific command path", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-attention-claude-cli-"));
    const settings = join(root, "settings.json");
    const command = "agent-attention claude-hook";
    try {
      const installed = capture();
      await expect(runCli(["install", "--host", "claude-code", "--settings", settings, "--command", command, "--json"], { io: installed.io })).resolves.toBe(0);
      expect(JSON.parse(installed.output().stdout).changed).toBe(true);
      expect((await readFile(settings, "utf8")).match(/agent-attention claude-hook/g)).toHaveLength(7);
      const removed = capture();
      await expect(runCli(["uninstall", "--host", "claude-code", "--settings", settings, "--command", command, "--json"], { io: removed.io })).resolves.toBe(0);
      expect(JSON.parse(removed.output().stdout).changed).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("OpenCode installer CLI", () => {
  it("installs and uninstalls through the host-specific command path", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-attention-opencode-cli-"));
    const config = join(root, "opencode.jsonc");
    const stateDir = join(root, "state");
    const plugin = join(root, "plugins", "agent-attention.js");
    try {
      const installed = capture();
      await expect(runCli(["install", "--host", "opencode", "--config", config, "--plugin", plugin, "--state-dir", stateDir, "--json"], { io: installed.io })).resolves.toBe(0);
      expect(JSON.parse(installed.output().stdout).changed).toBe(true);
      expect(JSON.parse(await readFile(config, "utf8"))).toEqual({ plugins: [plugin] });

      const repeated = capture();
      await expect(runCli(["install", "--host", "opencode", "--config", config, "--plugin", plugin, "--state-dir", stateDir, "--json"], { io: repeated.io })).resolves.toBe(0);
      expect(JSON.parse(repeated.output().stdout).changed).toBe(false);

      const removed = capture();
      await expect(runCli(["uninstall", "--host", "opencode", "--config", config, "--state-dir", stateDir, "--json"], { io: removed.io })).resolves.toBe(0);
      expect(JSON.parse(removed.output().stdout).changed).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
