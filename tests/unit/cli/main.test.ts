import { describe, expect, it } from "vitest";

import { runCli } from "../../../packages/cli/src/main";

function io() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write(value: string) { stdout += value; } },
      stderr: { write(value: string) { stderr += value; } },
    },
    output: () => ({ stdout, stderr }),
  };
}

describe("CLI foundation", () => {
  it("returns usage failure for an unknown command", async () => {
    const capture = io();
    await expect(runCli(["nope"], { io: capture.io })).resolves.toBe(2);
    expect(capture.output().stderr).toContain("Unknown command: nope");
  });

  it("keeps JSON output on stdout and returns successful responses", async () => {
    const capture = io();
    await expect(runCli(["status", "--json"], {
      io: capture.io,
      request: async () => ({ ok: true, result: { schemaVersion: 1 } }),
    })).resolves.toBe(0);
    expect(JSON.parse(capture.output().stdout)).toEqual({ ok: true, result: { schemaVersion: 1 } });
    expect(capture.output().stderr).toBe("");
  });

  it("returns host-unavailable exit code when the request cannot connect", async () => {
    const capture = io();
    await expect(runCli(["status"], {
      io: capture.io,
      request: async () => { throw new Error("pipe unavailable"); },
    })).resolves.toBe(3);
    expect(capture.output().stderr).toContain("Notification Host is not running");
  });
});
