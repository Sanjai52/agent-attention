#!/usr/bin/env node
/**
 * Throwaway S1 mock of the Anthropic Messages API.
 *
 * Purpose: the host's Claude Code installation cannot authenticate (expired
 * OAuth token). To observe the real hook machinery for tool and turn events we
 * point the real CLI at this local server. The model is mocked; every payload
 * recorded is produced by the real host. Do not treat model text as evidence.
 *
 * Usage: node mock-anthropic.cjs [port]
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:<port>
 *   ANTHROPIC_API_KEY=probe-key
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 8787);
const outDir =
  process.env.PROBE_OUT_DIR ||
  path.join(__dirname, "..", "out", "claude-code");
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, "mock-requests.jsonl");

function logRequest(entry) {
  const fd = fs.openSync(logFile, "a");
  try {
    fs.writeSync(fd, JSON.stringify(entry) + "\n");
  } finally {
    fs.closeSync(fd);
  }
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function startMessage(res, model, id) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  sse(res, "message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 1 },
    },
  });
}

function textBlock(res, index, text) {
  sse(res, "content_block_start", {
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "" },
  });
  sse(res, "content_block_delta", {
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index });
}

function toolBlock(res, index, id, name, input) {
  sse(res, "content_block_start", {
    type: "content_block_start",
    index,
    content_block: { type: "tool_use", id, name, input: {} },
  });
  sse(res, "content_block_delta", {
    type: "content_block_delta",
    index,
    delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index });
}

function endMessage(res, stopReason) {
  sse(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 7 },
  });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

function lastUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(" ");
    }
  }
  return "";
}

function hasToolResult(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((c) => c.type === "tool_result")
  );
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    let json = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    const url = req.url || "";
    const messages = json && json.messages;
    const userText = lastUserText(messages);
    const afterTool = hasToolResult(messages);
    const scenarioMatch = userText.match(/\b(PLAIN|TOOL_OK|TOOL_DENY|TOOL_FAIL|ASK)\b/);
    const scenario = scenarioMatch ? scenarioMatch[1] : afterTool ? "FOLLOWUP" : "OTHER";
    logRequest({
      at: new Date().toISOString(),
      method: req.method,
      url,
      model: json && json.model,
      streaming: json && json.stream,
      max_tokens: json && json.max_tokens,
      scenario,
      user_text: userText.slice(0, 200),
      tool_names:
        json && Array.isArray(json.tools)
          ? json.tools.map((t) => t.name).slice(0, 20)
          : null,
      message_count: Array.isArray(messages) ? messages.length : 0,
      system_present: Boolean(json && json.system),
    });

    if (url.includes("count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ input_tokens: 12 }));
      return;
    }

    const model = (json && json.model) || "claude-sonnet-4-5";
    const id = `msg_probe_${Date.now()}`;
    startMessage(res, model, id);

    if (scenario === "ASK") {
      toolBlock(res, 0, `toolu_probe_${Date.now()}`, "AskUserQuestion", {
        questions: [
          {
            question: "Probe question: continue?",
            header: "Probe",
            multiSelect: false,
            options: [
              { label: "Yes", description: "Continue the probe" },
              { label: "No", description: "Stop the probe" },
            ],
          },
        ],
      });
      endMessage(res, "tool_use");
      return;
    }

    if (scenario === "TOOL_OK" || scenario === "TOOL_DENY") {
      toolBlock(res, 0, `toolu_probe_${Date.now()}`, "Bash", {
        command: "node -e \"console.log('probe-tool-ok')\"",
        description: "Print a fixed probe string",
      });
      endMessage(res, "tool_use");
      return;
    }

    if (scenario === "TOOL_FAIL") {
      toolBlock(res, 0, `toolu_probe_${Date.now()}`, "Read", {
        file_path: path.join(
          __dirname,
          "..",
          "out",
          "claude-code",
          "sandbox",
          "missing-probe.txt"
        ),
      });
      endMessage(res, "tool_use");
      return;
    }

    textBlock(res, 0, scenario === "PLAIN" ? "probe-plain-text" : "probe-ok");
    endMessage(res, "end_turn");
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock anthropic listening on http://127.0.0.1:${port}`);
  console.log(`request log: ${logFile}`);
});
