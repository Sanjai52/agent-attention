// S1 Codex approval probe — drives the documented app-server JSON-RPC surface
// (thread/start + turn/start) so the documented PermissionRequest hook has a
// real approval to observe. Throwaway evidence code; do not promote.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "out", "codex");
mkdirSync(outDir, { recursive: true });
const protocolLog = createWriteStream(join(outDir, "permission-appserver.protocol.jsonl"), { flags: "a" });

const profile = join(here, "profile");
const cwd = join(here, "workspace");
const proc = spawn("codex", ["app-server", "-c", "bypass_hook_trust=true"], {
  env: { ...process.env, CODEX_HOME: profile, S1_RUN_LABEL: "permission" },
  stdio: ["pipe", "pipe", "inherit"],
  shell: true,
});

const send = (message) => proc.stdin.write(JSON.stringify(message) + "\n");
const rl = readline.createInterface({ input: proc.stdout });
let threadId = null;
let sawApproval = false;

rl.on("line", (line) => {
  protocolLog.write(line + "\n");
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  console.log("server:", JSON.stringify(msg).slice(0, 400));

  if (msg.id === 1 && msg.result?.thread?.id) {
    threadId = msg.result.thread.id;
    send({
      method: "turn/start",
      id: 2,
      params: {
        threadId,
        input: [{ type: "text", text: "Use the shell to create appserver-probe.txt in the current directory containing hello. Report the result." }],
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "readOnly" },
      },
    });
  }

  if (msg.method === "item/commandExecution/requestApproval" || msg.method === "item/fileChange/requestApproval") {
    sawApproval = true;
    console.log("APPROVAL REQUEST OBSERVED:", msg.method);
    send({ id: msg.id, result: { decision: "decline" } });
    setTimeout(() => {
      proc.kill();
      setTimeout(() => process.exit(sawApproval ? 0 : 3), 500);
    }, 1500);
  }

  if (msg.method === "turn/completed") {
    setTimeout(() => {
      proc.kill();
      setTimeout(() => process.exit(sawApproval ? 0 : 4), 500);
    }, 1000);
  }
});

send({
  method: "initialize",
  id: 0,
  params: { clientInfo: { name: "s1_codex_probe", title: "S1 Codex probe", version: "0.0.1" }, capabilities: { experimentalApi: true } },
});
send({ method: "initialized", params: {} });
send({
  method: "thread/start",
  id: 1,
  params: { cwd, approvalPolicy: "on-request", sandbox: "read-only", serviceName: "s1_codex_probe" },
});

setTimeout(() => {
  console.error("probe timeout; sawApproval=", sawApproval);
  proc.kill();
  setTimeout(() => process.exit(sawApproval ? 0 : 5), 500);
}, 120000);
