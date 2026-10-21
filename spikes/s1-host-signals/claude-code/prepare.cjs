#!/usr/bin/env node
/**
 * Throwaway S1 setup: builds a temporary CLAUDE_CONFIG_DIR, copies the current
 * user's Claude credentials into it (never modifies ~/.claude), and installs the
 * probe hooks from settings.template.json.
 *
 * The generated profile lives under spikes/s1-host-signals/out/claude-code/,
 * which is gitignored. Delete it with `node prepare.js --clean`.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const spikeRoot = path.join(__dirname, "..");
const outRoot = path.join(spikeRoot, "out", "claude-code");
const configDir = path.join(outRoot, "config");
const sandboxDir = path.join(outRoot, "sandbox");
const probeJs = path.join(__dirname, "hooks", "probe.cjs");
const templatePath = path.join(__dirname, "settings.template.json");

if (process.argv.includes("--clean")) {
  for (const dir of [configDir, sandboxDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`removed ${dir}`);
    } catch (err) {
      console.warn(`could not remove ${dir}: ${err.code || err.message}`);
    }
  }
  process.exit(0);
}

fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(sandboxDir, { recursive: true });

const userConfig = path.join(os.homedir(), ".claude");
const credentials = path.join(userConfig, ".credentials.json");
const credentialsTarget = path.join(configDir, ".credentials.json");
if (!fs.existsSync(credentials)) {
  console.error(
    `No credentials at ${credentials}. Set ANTHROPIC_API_KEY in the probe profile instead.`
  );
  process.exit(1);
}
fs.copyFileSync(credentials, credentialsTarget);

// Minimal account metadata. Deliberately excludes project history and settings.
const userClaudeJson = path.join(os.homedir(), ".claude.json");
if (fs.existsSync(userClaudeJson)) {
  const meta = JSON.parse(fs.readFileSync(userClaudeJson, "utf8"));
  fs.writeFileSync(
    path.join(configDir, ".claude.json"),
    JSON.stringify(
      {
        hasCompletedOnboarding: true,
        oauthAccount: meta.oauthAccount,
        userID: meta.userID,
        firstStartTime: meta.firstStartTime,
        installMethod: meta.installMethod,
      },
      null,
      2
    )
  );
}

const template = fs.readFileSync(templatePath, "utf8");
if (!template.includes("__PROBE_JS__")) {
  console.error("settings.template.json is missing __PROBE_JS__");
  process.exit(1);
}
fs.writeFileSync(
  path.join(configDir, "settings.json"),
  template.split("__PROBE_JS__").join(probeJs.replace(/\\/g, "\\\\"))
);

console.log(`profile: ${configDir}`);
console.log(`sandbox: ${sandboxDir}`);
console.log(`probe:   ${probeJs}`);
console.log("");
console.log("Run a capture with:");
console.log(
  `  CLAUDE_CONFIG_DIR="${configDir}" PROBE_RUN_ID=<id> claude -p --permission-mode default "<prompt>"`
);
