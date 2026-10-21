import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  PIPE_SECURITY_DESCRIPTOR,
  PipeAclError,
  hardenNamedPipeAcl,
  readNamedPipeAcl,
} from "@agent-attention/platform-windows";

const IS_WINDOWS = process.platform === "win32";

describe.skipIf(!IS_WINDOWS)("named-pipe ACL hardening", () => {
  let server: net.Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it("replaces the default broad DACL with SYSTEM and the pipe owner", async () => {
    const pipe = `\\\\.\\pipe\\agent-attention-acl-test-${process.pid}-${Date.now()}`;
    server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(pipe, () => resolve());
    });

    const before = await readNamedPipeAcl(pipe);
    expect(before).not.toBe(PIPE_SECURITY_DESCRIPTOR);

    await hardenNamedPipeAcl(pipe);
    await expect(readNamedPipeAcl(pipe)).resolves.toBe(PIPE_SECURITY_DESCRIPTOR);
  });

  it("fails closed when the pipe does not exist", async () => {
    const pipe = `\\\\.\\pipe\\agent-attention-acl-missing-${process.pid}-${Date.now()}`;
    await expect(hardenNamedPipeAcl(pipe)).rejects.toBeInstanceOf(PipeAclError);
  });
});
