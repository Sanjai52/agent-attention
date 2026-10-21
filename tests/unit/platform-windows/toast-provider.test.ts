import { describe, expect, it } from "vitest";
import {
  buildToastXml,
  createWindowsToastProvider,
  escapeXml,
} from "@agent-attention/platform-windows";
import { createFakeRunner, scriptResult } from "./fake-runner";

const SCRIPT_PATH = "C:\\app\\scripts\\toast.ps1";

function decodeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return "";
    }
  });
}

/**
 * Tiny strict parser for the exact toast shape this provider emits. `[^<]*`
 * fails if any interpolated value leaked raw markup into a text node.
 */
function parseToastXml(xml: string): { title: string; body: string } {
  const match =
    /^<toast><visual><binding template="ToastGeneric"><text>([^<]*)<\/text><text>([^<]*)<\/text><\/binding><\/visual><audio silent="true"\/><\/toast>$/.exec(
      xml,
    );
  if (match === null) throw new Error(`not a safe toast document: ${xml}`);
  return { title: decodeXml(match[1]!), body: decodeXml(match[2]!) };
}

const ALWAYS_REGISTERED = async (): Promise<boolean> => true;

describe("escapeXml", () => {
  it("escapes all five XML metacharacters", () => {
    expect(escapeXml(`a<b>&"'`)).toBe("a&lt;b&gt;&amp;&quot;&apos;");
  });

  it("does not double-escape already-escaped text", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });

  it("strips characters that are invalid in XML 1.0", () => {
    expect(escapeXml("a\u0000b\u0001c\u000Bd\u001Fe")).toBe("abcde");
    expect(escapeXml("tab\tline\ncarriage\r")).toBe("tab\tline\ncarriage\r");
  });
});

describe("buildToastXml", () => {
  it("renders a hostile title as text, not markup", () => {
    const xml = buildToastXml("<script>alert(1)</script>", "Project: <b>Evil</b>");
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(parseToastXml(xml)).toEqual({
      title: "<script>alert(1)</script>",
      body: "Project: <b>Evil</b>",
    });
  });

  it("produces valid XML for a hostile project name", () => {
    const hostile = `<b>Evil</b> & "quoted" '; rm -rf ~ # $(calc) \`whoami\` %TEMP% \u202Egnp.exe`;
    const xml = buildToastXml("Agent needs input", `Project: ${hostile}\u0001`);
    expect(parseToastXml(xml)).toEqual({
      title: "Agent needs input",
      body: `Project: ${hostile}`,
    });
  });
});

describe("createWindowsToastProvider", () => {
  it("submits the escaped XML through stdin and never through argv", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ stdout: JSON.stringify({ submitted: true }) }),
    );
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: ALWAYS_REGISTERED,
      runScript: runner.run,
    });
    const title = "Agent needs approval";
    const body = `Project: <b>Evil</b> & "quoted" '; rm -rf ~ # $(calc)`;

    await expect(provider.show({ title, body })).resolves.toEqual({
      status: "delivered",
    });

    const call = runner.calls[0]!;
    expect(call.options.scriptPath).toBe(SCRIPT_PATH);
    expect(call.options.args).toEqual(["-Mode", "send"]);
    expect(call.options.stdin).toBe(buildToastXml(title, body));
    expect(call.options.args.join(" ")).not.toContain("Evil");
    expect(call.options.args.join(" ")).not.toContain("calc");
  });

  it("reports delivered when submitted, even if notifications are disabled", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({
        stdout: JSON.stringify({
          submitted: true,
          notifierSetting: "DisabledForApplication",
        }),
      }),
    );
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: ALWAYS_REGISTERED,
      runScript: runner.run,
    });

    await expect(
      provider.show({ title: "title", body: "body" }),
    ).resolves.toEqual({ status: "delivered" });
  });

  it("is unavailable when the toast identity is not registered", async () => {
    const runner = createFakeRunner();
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: async () => false,
      runScript: runner.run,
    });

    await expect(
      provider.show({ title: "title", body: "body" }),
    ).resolves.toEqual({
      status: "unavailable",
      errorCode: "toast_not_registered",
    });
    expect(runner.calls).toHaveLength(0);
  });

  it("returns unavailable when the registration check throws", async () => {
    const runner = createFakeRunner();
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: async () => {
        throw new Error("registry exploded");
      },
      runScript: runner.run,
    });

    await expect(
      provider.show({ title: "title", body: "body" }),
    ).resolves.toEqual({
      status: "unavailable",
      errorCode: "registration_check_failed",
    });
    expect(runner.calls).toHaveLength(0);
  });

  it("checks registration once per provider instance", async () => {
    let checks = 0;
    const runner = createFakeRunner(() =>
      scriptResult({ stdout: JSON.stringify({ submitted: true }) }),
    );
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: async () => {
        checks += 1;
        return true;
      },
      runScript: runner.run,
    });

    await provider.show({ title: "one", body: "body" });
    await provider.show({ title: "two", body: "body" });

    expect(checks).toBe(1);
    expect(runner.calls).toHaveLength(2);
  });

  it("reports failed when the script says it did not submit", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({
        code: 2,
        stdout: JSON.stringify({ submitted: false, error: "XmlDocument rejected" }),
      }),
    );
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: ALWAYS_REGISTERED,
      runScript: runner.run,
    });

    await expect(
      provider.show({ title: "title", body: "body" }),
    ).resolves.toEqual({ status: "failed", errorCode: "toast_submit_failed" });
  });

  it("reports failed for a non-zero exit without a result", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: 2, stderr: "TOAST_SUBMIT_FAILED" }),
    );
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: ALWAYS_REGISTERED,
      runScript: runner.run,
    });

    await expect(
      provider.show({ title: "title", body: "body" }),
    ).resolves.toEqual({ status: "failed", errorCode: "toast_submit_failed" });
  });

  it("reports failed for invalid script output", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ stdout: "not json" }),
    );
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: ALWAYS_REGISTERED,
      runScript: runner.run,
    });

    await expect(
      provider.show({ title: "title", body: "body" }),
    ).resolves.toEqual({ status: "failed", errorCode: "invalid_script_output" });
  });

  it("maps a timeout to failed", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: -1, timedOut: true }),
    );
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: ALWAYS_REGISTERED,
      runScript: runner.run,
    });

    await expect(
      provider.show({ title: "title", body: "body" }),
    ).resolves.toEqual({ status: "failed", errorCode: "timeout" });
  });

  it("maps a spawn error to unavailable", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: -1, spawnError: "spawn powershell.exe ENOENT" }),
    );
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: ALWAYS_REGISTERED,
      runScript: runner.run,
    });

    await expect(
      provider.show({ title: "title", body: "body" }),
    ).resolves.toEqual({
      status: "unavailable",
      errorCode: "powershell_unavailable",
    });
  });

  it("never throws when the runner rejects", async () => {
    const provider = createWindowsToastProvider({
      appId: "AgentAttention.Desktop",
      scriptPath: SCRIPT_PATH,
      isRegistered: ALWAYS_REGISTERED,
      runScript: async () => {
        throw new Error("unexpected");
      },
    });

    await expect(
      provider.show({ title: "title", body: "body" }),
    ).resolves.toEqual({ status: "failed", errorCode: "provider_error" });
  });
});
