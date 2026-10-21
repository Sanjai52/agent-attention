import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installClaudeCode, uninstallClaudeCode } from "../../../packages/cli/src/install/claude-code";

describe("installClaudeCode", () => {
  it("merges all hooks, is idempotent, and removes only its command", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-attention-claude-install-"));
    const settingsPath = join(root, "settings.json");
    const stateDir = join(root, "state");
    const command = "agent-attention claude-hook";
    try {
      const first = await installClaudeCode({ settingsPath, stateDir, hookCommand: command, now: () => new Date("2026-10-21T10:00:00.000Z") });
      expect(first.changed).toBe(true);
      const installed = await readFile(settingsPath, "utf8");
      expect(installed.match(/agent-attention claude-hook/g)).toHaveLength(7);

      const second = await installClaudeCode({ settingsPath, stateDir, hookCommand: command });
      expect(second.changed).toBe(false);
      expect(await readFile(settingsPath, "utf8")).toBe(installed);

      const withUserEdit = installed.replace("agent-attention claude-hook", "user-owned-hook");
      await import("node:fs/promises").then(({ writeFile }) => writeFile(settingsPath, withUserEdit));
      const uninstall = await uninstallClaudeCode({ settingsPath, stateDir, hookCommand: command });
      expect(uninstall.changed).toBe(true);
      const remaining = await readFile(settingsPath, "utf8");
      expect(remaining).toContain("user-owned-hook");
      expect(remaining).not.toContain("agent-attention claude-hook");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
