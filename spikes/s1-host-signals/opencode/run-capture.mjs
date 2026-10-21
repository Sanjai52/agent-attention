// S1 throwaway capture driver. Starts a private OpenCode v2 server per scenario,
// drives the documented HTTP API, and leaves the probe plugin JSONL + run.json.
// Evidence-only code; do not promote.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const outDir = join(repoRoot, "spikes/s1-host-signals/out/opencode");
const sandbox = join(here, "sandbox");
const configFile = join(here, "config/opencode.json");
const password = "s1-probe-password";

const model = { providerID: "opencode", id: "deepseek-v4.1-flash-free" };
const badModel = { providerID: "github-copilot", id: "claude-haiku-4.5" };

mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function basicAuth() {
  return "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
}

async function api(port, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      authorization: basicAuth(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  return parsed;
}

function startServer(port, logPath) {
  const child = spawn(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/s", "/c", `opencode serve --hostname 127.0.0.1 --port ${port}`],
    {
      cwd: sandbox,
      windowsHide: true,
      env: {
        ...process.env,
        OPENCODE_CONFIG: configFile,
        OPENCODE_CONFIG_PROJECT_DISABLE: "1",
        // The user's global config defines two MCP servers. Disable them so each
        // probe server starts promptly; the global config file is not modified.
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          mcp: { servers: { playwright: { enabled: false }, rea: { enabled: false } } },
        }),
        OPENCODE_SERVER_PASSWORD: password,
        S1_PROBE_LOG: logPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  return { child, output };
}

async function waitForServer(port, server, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await api(port, "GET", "/api/session?limit=1");
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`server did not become ready on ${port}\n${server.output.join("")}`);
}

async function waitForTerminal(port, sessionID, logPath, timeoutMs = 90000) {
  const { readFileSync } = await import("node:fs");
  const deadline = Date.now() + timeoutMs;
  let terminalEvent;
  while (Date.now() < deadline) {
    try {
      const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const record = JSON.parse(line);
        if (
          record.kind === "event" &&
          record.event?.data?.sessionID === sessionID &&
          /^session\.execution\.(succeeded|failed|interrupted)$/.test(record.event.type)
        ) {
          terminalEvent = record.event;
        }
      }
    } catch {
      // log not created yet
    }
    if (terminalEvent) break;
    await sleep(300);
  }
  const result = await api(port, "GET", `/api/session/${sessionID}`);
  return { session: result.data, terminalEvent };
}

async function waitForPendingPermission(port, sessionID, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await api(port, "GET", `/api/session/${sessionID}/permission`);
    const pending = result.data ?? [];
    if (pending.length > 0) return pending;
    await sleep(250);
  }
  throw new Error(`session ${sessionID} produced no permission request`);
}

async function waitForEventType(logPath, type, timeoutMs = 30000) {
  const { readFileSync } = await import("node:fs");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const record = JSON.parse(line);
        if (record.kind === "event" && record.event?.type === type) return record;
      }
    } catch {
      // log not created yet
    }
    await sleep(250);
  }
  return undefined;
}

async function stopServer(server) {
  const { child } = server;
  // The server runs behind cmd.exe, so kill the whole process tree.
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  const deadline = Date.now() + 3000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
  child.stdout?.destroy();
  child.stderr?.destroy();
}

async function newSession(port, title, sessionModel = model) {
  const result = await api(port, "POST", "/api/session", { title, model: sessionModel });
  return result.data.id;
}

const scenarios = [
  {
    id: "permission-allow",
    title: "S1 permission allow",
    prompt:
      "Use the bash/shell tool to run exactly: echo probe\nThen reply with the tool output and nothing else.",
    async run(port, sessionID) {
      const pending = await waitForPendingPermission(port, sessionID);
      await api(port, "POST", `/api/session/${sessionID}/permission/${pending[0].id}/reply`, {
        decision: "once",
      });
      return { replied: "once", permission: pending[0] };
    },
  },
  {
    id: "permission-deny",
    title: "S1 permission deny",
    prompt:
      "Use the bash/shell tool to run exactly: echo probe\nThen reply with the tool output and nothing else.",
    async run(port, sessionID) {
      const pending = await waitForPendingPermission(port, sessionID);
      await api(port, "POST", `/api/session/${sessionID}/permission/${pending[0].id}/reply`, {
        decision: "reject",
      });
      return { replied: "reject", permission: pending[0] };
    },
  },
  {
    id: "plain-text",
    title: "S1 plain text turn end",
    prompt: "Reply with exactly PLAIN_TEXT_OK and do not use any tools.",
    async run(port, sessionID) {
      const started = await waitForEventType(
        join(outDir, `${this.id}.jsonl`),
        "session.execution.started",
      );
      return { executionStarted: Boolean(started) };
    },
  },
  {
    id: "negative-progress",
    title: "S1 negative progress test",
    prompt:
      "Reply with exactly NEGATIVE_PROGRESS_OK and do not use any tools. This is an ordinary progress-only turn.",
    async run(port, sessionID) {
      await waitForEventType(join(outDir, `${this.id}.jsonl`), "session.execution.started");
      return { note: "No permission should be requested on this turn" };
    },
  },
  {
    id: "abort",
    title: "S1 aborted turn",
    prompt:
      "Use the bash/shell tool to run exactly: echo probe\nAfter the command, explain the output in detail.",
    async run(port, sessionID) {
      await waitForEventType(join(outDir, `${this.id}.jsonl`), "session.execution.started");
      await sleep(1500);
      await api(port, "POST", `/api/session/${sessionID}/interrupt`, { continue: false });
      return { interrupted: true };
    },
  },
  {
    id: "error-invalid-model",
    title: "S1 provider error",
    prompt: "Reply with exactly PROBE_OK.",
    model: badModel,
    async run() {
      return { note: "invalid model forces a provider error" };
    },
  },
  {
    id: "subagent",
    title: "S1 subagent",
    prompt:
      "Use the task tool to launch a subagent that replies with exactly SUBAGENT_OK. Then report the subagent result and stop.",
    async run(port, sessionID) {
      await waitForEventType(join(outDir, `${this.id}.jsonl`), "session.execution.started");
      return { note: "let the parent drive a child session" };
    },
  },
];

const runReport = {
  host: "opencode",
  version: undefined,
  started: new Date().toISOString(),
  windows: undefined,
  node: process.version,
  configFile,
  scenarios: [],
};

async function main() {
  const version = await new Promise((resolve) => {
    const child = spawn(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", "opencode --version"],
      {
        windowsHide: true,
      },
    );
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk.toString()));
    child.on("exit", () => resolve(text.trim()));
  });
  runReport.version = version;

  const only = process.argv[2];
  const selected = only ? scenarios.filter((scenario) => scenario.id === only) : scenarios;
  for (let index = 0; index < selected.length; index += 1) {
    const scenario = selected[index];
    const port = 47840 + scenarios.indexOf(scenario);
    const logPath = join(outDir, `${scenario.id}.jsonl`);
    writeFileSync(logPath, "");
    const server = startServer(port, logPath);
    const record = { id: scenario.id, port, logPath, started: new Date().toISOString() };
    try {
      await waitForServer(port, server);
      const sessionID = await newSession(port, scenario.title, scenario.model ?? model);
      record.sessionID = sessionID;
      record.prompt = scenario.prompt;
      await api(port, "POST", `/api/session/${sessionID}/prompt`, { text: scenario.prompt });
      record.driver = await scenario.run.call(scenario, port, sessionID);
      const terminal = await waitForTerminal(port, sessionID, logPath);
      record.terminalEvent = terminal.terminalEvent;
      record.session = terminal.session.outcome ?? null;
      record.sessionIdleTime = terminal.session.time?.idle ?? null;
      record.sessionInfo = { data: terminal.session };
      record.ok = Boolean(terminal.terminalEvent);
      if (!record.ok) record.error = "no session.execution.* terminal event observed";
    } catch (error) {
      record.ok = false;
      record.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    } finally {
      await stopServer(server);
      record.serverOutput = server.output.join("").trim();
      record.finished = new Date().toISOString();
      runReport.scenarios.push(record);
      console.log(
        `${record.ok ? "OK  " : "FAIL"} ${scenario.id} -> ${record.session ?? record.error}`,
      );
    }
  }

  runReport.finished = new Date().toISOString();
  writeFileSync(join(outDir, "run.json"), JSON.stringify(runReport, null, 2) + "\n");
  const failures = runReport.scenarios.filter((scenario) => !scenario.ok);
  console.log(
    `captures: ${runReport.scenarios.length - failures.length}/${runReport.scenarios.length} ok`,
  );
  process.exit(failures.length > 0 ? 1 : 0);
}

await main();
