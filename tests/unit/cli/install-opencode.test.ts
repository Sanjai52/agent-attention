import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultOpenCodeConfigPath,
  defaultOpenCodeStateDir,
  installOpenCode,
  uninstallOpenCode,
} from "@agent-attention/cli";

const FIXED_DATE = new Date(2026, 9, 21, 13, 5, 9);
const FIXED_TIMESTAMP = "20261021130509";

interface MarkerFile {
  configPath: string;
  pluginEntry: string;
  backupPath: string | null;
  createdConfig: boolean;
  installedContentSha256: string;
}

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-attention-install-"));
  tempRoots.push(root);
  return root;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files.sort();
}

async function readMarker(stateDir: string): Promise<MarkerFile> {
  const text = await readFile(join(stateDir, "opencode.json"), "utf8");
  return JSON.parse(text) as MarkerFile;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonc(text: string): unknown {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);

    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        output += char;
      }
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  return JSON.parse(output.replace(/,\s*([}\]])/g, "$1")) as unknown;
}

function parseConfig(text: string): Record<string, unknown> {
  return parseJsonc(text) as Record<string, unknown>;
}

describe("defaultOpenCodeConfigPath", () => {
  it("prefers OPENCODE_CONFIG", () => {
    const home = join("home", "user");
    expect(
      defaultOpenCodeConfigPath(
        {
          OPENCODE_CONFIG: join("custom", "opencode.jsonc"),
          XDG_CONFIG_HOME: join("xdg", "config"),
        },
        home,
      ),
    ).toBe(join("custom", "opencode.jsonc"));
  });

  it("uses XDG_CONFIG_HOME when OPENCODE_CONFIG is unset", () => {
    const home = join("home", "user");
    expect(
      defaultOpenCodeConfigPath(
        { XDG_CONFIG_HOME: join("xdg", "config") },
        home,
      ),
    ).toBe(join("xdg", "config", "opencode", "opencode.jsonc"));
  });

  it("falls back to ~/.config/opencode/opencode.jsonc", () => {
    const home = join("home", "user");
    expect(defaultOpenCodeConfigPath({}, home)).toBe(
      join(home, ".config", "opencode", "opencode.jsonc"),
    );
  });
});

describe("defaultOpenCodeStateDir", () => {
  it("uses LOCALAPPDATA when available", () => {
    const home = join("home", "user");
    expect(
      defaultOpenCodeStateDir(
        { LOCALAPPDATA: join("local", "appdata") },
        home,
      ),
    ).toBe(join("local", "appdata", "AgentAttention", "install"));
  });

  it("falls back to ~/.local/share/AgentAttention/install", () => {
    const home = join("home", "user");
    expect(defaultOpenCodeStateDir({}, home)).toBe(
      join(home, ".local", "share", "AgentAttention", "install"),
    );
  });
});

describe("installOpenCode", () => {
  it("merges into existing JSONC while preserving comments, formatting, and unrelated keys", async () => {
    const root = await makeRoot();
    const configDir = join(root, "config");
    const stateDir = join(root, "state");
    await mkdir(configDir, { recursive: true });

    const configPath = join(configDir, "opencode.jsonc");
    const original = [
      "{",
      "  // keep this comment",
      '  "$schema": "https://opencode.ai/config.json",',
      '  "model": "anthropic/claude-sonnet-4",',
      '  "unknown": { "nested": [1, 2, 3] },',
      '  "plugins": [',
      '    "existing-plugin", // keep existing entry',
      "  ],",
      "}",
      "",
    ].join("\n");
    await writeFile(configPath, original, "utf8");

    const pluginEntry = join(root, "plugins", "agent-attention.js");
    const report = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
    });

    expect(report.changed).toBe(true);
    expect(report.entries).toEqual([pluginEntry]);
    expect(report.backedUpTo).toBe(
      `${configPath}.agent-attention-backup-${FIXED_TIMESTAMP}`,
    );

    const updated = await readFile(configPath, "utf8");
    expect(updated).toContain("// keep this comment");
    expect(updated).toContain("// keep existing entry");
    expect(updated).toContain(JSON.stringify(pluginEntry));

    const parsed = parseConfig(updated);
    expect(parsed["$schema"]).toBe("https://opencode.ai/config.json");
    expect(parsed.model).toBe("anthropic/claude-sonnet-4");
    expect(parsed.unknown).toEqual({ nested: [1, 2, 3] });
    expect(parsed.plugins).toEqual(["existing-plugin", pluginEntry]);

    expect(await readFile(report.backedUpTo as string, "utf8")).toBe(original);

    expect(await readMarker(stateDir)).toEqual({
      configPath,
      pluginEntry,
      backupPath: report.backedUpTo,
      createdConfig: false,
      installedContentSha256: sha256(updated),
    });
  });

  it("creates a missing config and uninstall removes it", async () => {
    const root = await makeRoot();
    const configPath = join(root, "nested", "opencode.jsonc");
    const stateDir = join(root, "state");
    const pluginEntry = join(root, "plugins", "agent-attention.js");

    const report = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
    });

    expect(report.changed).toBe(true);
    expect(report.backedUpTo).toBeUndefined();
    expect(parseConfig(await readFile(configPath, "utf8")).plugins).toEqual([
      pluginEntry,
    ]);

    expect(await readMarker(stateDir)).toEqual({
      configPath,
      pluginEntry,
      backupPath: null,
      createdConfig: true,
      installedContentSha256: sha256(await readFile(configPath, "utf8")),
    });

    const uninstall = await uninstallOpenCode({
      hostConfigPath: configPath,
      stateDir,
    });

    expect(uninstall.changed).toBe(true);
    expect(uninstall.entries).toEqual([pluginEntry]);
    expect(await exists(configPath)).toBe(false);
    expect(await exists(join(stateDir, "opencode.json"))).toBe(false);
  });

  it("is idempotent and does not create a second backup", async () => {
    const root = await makeRoot();
    const configDir = join(root, "config");
    const stateDir = join(root, "state");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.jsonc");
    const pluginEntry = join(root, "plugins", "agent-attention.js");
    await writeFile(
      configPath,
      '{\n  "plugins": ["existing"]\n}\n',
      "utf8",
    );

    const first = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
    });
    const installedBytes = await readFile(configPath);
    const marker = await readMarker(stateDir);

    const second = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => new Date(FIXED_DATE.getTime() + 60_000),
    });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.backedUpTo).toBeUndefined();
    expect(second.entries).toEqual([pluginEntry]);
    expect((await readFile(configPath)).equals(installedBytes)).toBe(true);
    expect(await readMarker(stateDir)).toEqual(marker);

    const backupNames = (await readdir(configDir)).filter((name) =>
      name.includes(".agent-attention-backup-"),
    );
    expect(backupNames).toHaveLength(1);
  });

  it("does not write anything during a dry run", async () => {
    const root = await makeRoot();
    const configDir = join(root, "config");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.jsonc");
    const stateDir = join(root, "state");
    const pluginEntry = join(root, "plugins", "agent-attention.js");
    const original = '{\n  // keep\n  "plugins": []\n}\n';
    await writeFile(configPath, original, "utf8");

    const report = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
      dryRun: true,
    });

    expect(report.changed).toBe(true);
    expect(report.entries).toEqual([pluginEntry]);
    expect(report.backedUpTo).toBe(
      `${configPath}.agent-attention-backup-${FIXED_TIMESTAMP}`,
    );
    expect(await readFile(configPath, "utf8")).toBe(original);
    expect(await exists(stateDir)).toBe(false);
    expect(await exists(report.backedUpTo as string)).toBe(false);

    const installed = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
    });
    expect(installed.changed).toBe(true);

    const installedBytes = await readFile(configPath);
    const repeatedDryRun = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
      dryRun: true,
    });
    expect(repeatedDryRun.changed).toBe(false);
    expect(repeatedDryRun.backedUpTo).toBeUndefined();
    expect((await readFile(configPath)).equals(installedBytes)).toBe(true);
  });

  it("does not create a missing config during a dry run", async () => {
    const root = await makeRoot();
    const configPath = join(root, "nested", "opencode.jsonc");
    const stateDir = join(root, "state");
    const pluginEntry = join(root, "plugins", "agent-attention.js");

    const report = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
      dryRun: true,
    });

    expect(report.changed).toBe(true);
    expect(report.backedUpTo).toBeUndefined();
    expect(await exists(configPath)).toBe(false);
    expect(await exists(dirname(configPath))).toBe(false);
    expect(await exists(stateDir)).toBe(false);
  });

  it("rejects a non-object config without replacing it", async () => {
    const root = await makeRoot();
    const configPath = join(root, "opencode.jsonc");
    const stateDir = join(root, "state");
    const original = '["not", "an", "object"]\n';
    await writeFile(configPath, original, "utf8");

    await expect(
      installOpenCode({
        hostConfigPath: configPath,
        pluginEntry: join(root, "plugins", "agent-attention.js"),
        stateDir,
        now: () => FIXED_DATE,
      }),
    ).rejects.toThrow(/object/i);

    expect(await readFile(configPath, "utf8")).toBe(original);
    expect(await exists(stateDir)).toBe(false);
  });
});

describe("uninstallOpenCode", () => {
  it("restores the backup byte-for-byte when the config was not edited", async () => {
    const root = await makeRoot();
    const configDir = join(root, "config");
    const stateDir = join(root, "state");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.jsonc");
    const pluginEntry = join(root, "plugins", "agent-attention.js");
    const original = [
      "{",
      "  // CRLF and comments must survive",
      '  "model": "test-model",',
      '  "plugins": ["existing"]',
      "}",
      "",
    ].join("\r\n");
    await writeFile(configPath, original, "utf8");

    await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
    });
    expect(
      parseConfig(await readFile(configPath, "utf8")).plugins,
    ).toContain(pluginEntry);

    const report = await uninstallOpenCode({
      hostConfigPath: configPath,
      stateDir,
    });

    expect(report.changed).toBe(true);
    expect(report.entries).toEqual([pluginEntry]);
    expect(
      (await readFile(configPath)).equals(Buffer.from(original, "utf8")),
    ).toBe(true);
    expect(await exists(join(stateDir, "opencode.json"))).toBe(false);
  });

  it("removes only the marked plugin entry when the user edited the config", async () => {
    const root = await makeRoot();
    const configPath = join(root, "opencode.jsonc");
    const stateDir = join(root, "state");
    const pluginEntry = join(root, "plugins", "agent-attention.js");
    const original =
      '{\n  // original comment\n  "plugins": ["existing"]\n}\n';
    await writeFile(configPath, original, "utf8");

    await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
    });

    const installed = await readFile(configPath, "utf8");
    const edited = installed.replace(
      /^\{/,
      '{\n  "userEdited": { "keep": true },',
    );
    await writeFile(configPath, edited, "utf8");

    const report = await uninstallOpenCode({
      hostConfigPath: configPath,
      stateDir,
    });

    expect(report.changed).toBe(true);
    const finalText = await readFile(configPath, "utf8");
    const parsed = parseConfig(finalText);
    expect(parsed.plugins).toEqual(["existing"]);
    expect(parsed.userEdited).toEqual({ keep: true });
    expect(finalText).toContain("// original comment");
    expect(await exists(join(stateDir, "opencode.json"))).toBe(false);
  });

  it("leaves a user config untouched when the marked entry is already gone", async () => {
    const root = await makeRoot();
    const configPath = join(root, "opencode.jsonc");
    const stateDir = join(root, "state");
    const pluginEntry = join(root, "plugins", "agent-attention.js");
    await writeFile(configPath, '{\n  "plugins": []\n}\n', "utf8");

    await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
    });

    const edited = '{\n  // user removed the plugin\n  "plugins": []\n}\n';
    await writeFile(configPath, edited, "utf8");

    const report = await uninstallOpenCode({
      hostConfigPath: configPath,
      stateDir,
    });

    expect(report.changed).toBe(true);
    expect(await readFile(configPath, "utf8")).toBe(edited);
    expect(await exists(join(stateDir, "opencode.json"))).toBe(false);
  });

  it("returns unchanged when no marker exists", async () => {
    const root = await makeRoot();
    const configPath = join(root, "opencode.jsonc");
    const stateDir = join(root, "state");
    const original = '{\n  "plugins": ["existing"]\n}\n';
    await writeFile(configPath, original, "utf8");

    const report = await uninstallOpenCode({
      hostConfigPath: configPath,
      stateDir,
    });

    expect(report).toEqual({ changed: false, entries: [] });
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  it("purge removes marker and backup state but not unrelated files", async () => {
    const root = await makeRoot();
    const configDir = join(root, "config");
    const stateDir = join(root, "state");
    await mkdir(configDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    const configPath = join(configDir, "opencode.jsonc");
    const pluginEntry = join(root, "plugins", "agent-attention.js");
    const original = '{\n  "plugins": ["existing"]\n}\n';
    await writeFile(configPath, original, "utf8");
    await writeFile(join(stateDir, "unrelated.json"), "keep me\n", "utf8");
    const outsidePath = join(root, "outside.txt");
    await writeFile(outsidePath, "keep me too\n", "utf8");

    const install = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry,
      stateDir,
      now: () => FIXED_DATE,
    });
    const backupPath = install.backedUpTo as string;

    const report = await uninstallOpenCode({
      hostConfigPath: configPath,
      stateDir,
      purge: true,
    });

    expect(report.changed).toBe(true);
    expect(await readFile(configPath, "utf8")).toBe(original);
    expect(await exists(backupPath)).toBe(false);
    expect(await exists(join(stateDir, "opencode.json"))).toBe(false);
    expect(await readFile(join(stateDir, "unrelated.json"), "utf8")).toBe(
      "keep me\n",
    );
    expect(await readFile(outsidePath, "utf8")).toBe("keep me too\n");
  });

  it("keeps the backup after a normal uninstall", async () => {
    const root = await makeRoot();
    const configPath = join(root, "opencode.jsonc");
    const stateDir = join(root, "state");
    await writeFile(configPath, '{\n  "plugins": []\n}\n', "utf8");

    const install = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry: join(root, "plugins", "agent-attention.js"),
      stateDir,
      now: () => FIXED_DATE,
    });

    await uninstallOpenCode({ hostConfigPath: configPath, stateDir });

    expect(await exists(install.backedUpTo as string)).toBe(true);
    expect(await exists(join(stateDir, "opencode.json"))).toBe(false);
  });
});

describe("path containment", () => {
  it("writes only the config, its adjacent backup, and the marker", async () => {
    const root = await makeRoot();
    const configDir = join(root, "config");
    const stateDir = join(root, "state");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.jsonc");
    await writeFile(configPath, '{\n  "plugins": []\n}\n', "utf8");

    const before = await listFiles(root);
    const report = await installOpenCode({
      hostConfigPath: configPath,
      pluginEntry: join(root, "plugins", "agent-attention.js"),
      stateDir,
      now: () => FIXED_DATE,
    });
    const after = await listFiles(root);

    const added = after.filter((path) => !before.includes(path));
    const expectedMarker = join(stateDir, "opencode.json");
    expect(added).toEqual(
      [report.backedUpTo as string, expectedMarker].sort(),
    );
    expect(dirname(report.backedUpTo as string)).toBe(dirname(configPath));
    expect(dirname(expectedMarker)).toBe(stateDir);

    await uninstallOpenCode({ hostConfigPath: configPath, stateDir });
    expect(await listFiles(root)).toEqual(
      [configPath, report.backedUpTo as string].sort(),
    );
  });
});
