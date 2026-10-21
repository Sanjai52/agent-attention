import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";
import type { InstallReport } from "./types";

export const CLAUDE_CODE_HOOKS = ["SessionStart", "PermissionRequest", "PostToolUse", "Stop", "StopFailure", "PostToolUseFailure", "SessionEnd"] as const;
export type ClaudeCodeHookName = (typeof CLAUDE_CODE_HOOKS)[number];

export interface InstallClaudeCodeDeps {
  settingsPath: string;
  hookCommand: string;
  stateDir?: string;
  now?: () => Date;
  dryRun?: boolean;
}

export interface UninstallClaudeCodeDeps { settingsPath: string; hookCommand: string; stateDir?: string; purge?: boolean; }

interface Marker { settingsPath: string; hookCommand: string; backupPath: string | null; installedContentSha256: string; }

const markerName = "claude-code.json";

export function defaultClaudeCodeSettingsPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.CLAUDE_CODE_SETTINGS?.trim() || join(home, ".claude", "settings.json");
}

export function defaultClaudeCodeStateDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(env.LOCALAPPDATA?.trim() || join(home, ".local", "share"), "AgentAttention", "install");
}

function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function markerPath(stateDir: string): string { return join(resolve(stateDir), markerName); }
function commandHook(command: string): { type: "command"; command: string; async: true } { return { type: "command", command, async: true }; }

async function readExisting(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path); } catch { return undefined; }
}

export async function installClaudeCode(deps: InstallClaudeCodeDeps): Promise<InstallReport> {
  if (!deps.settingsPath.trim() || !deps.hookCommand.trim()) throw new Error("settingsPath and hookCommand are required");
  const settingsPath = resolve(deps.settingsPath);
  const stateDir = resolve(deps.stateDir ?? defaultClaudeCodeStateDir());
  const existing = await readExisting(settingsPath);
  const text = existing?.toString("utf8") ?? "{}\n";
  const parsed = parse(text) as Record<string, unknown>;
  const hooks = typeof parsed.hooks === "object" && parsed.hooks !== null && !Array.isArray(parsed.hooks) ? parsed.hooks as Record<string, unknown> : {};
  const updatedHooks = structuredClone(hooks) as Record<string, unknown>;
  let changed = false;
  for (const name of CLAUDE_CODE_HOOKS) {
    const groups = Array.isArray(updatedHooks[name]) ? structuredClone(updatedHooks[name]) as Array<Record<string, unknown>> : [];
    const first = groups[0] ?? { hooks: [] };
    const entries = Array.isArray(first.hooks) ? first.hooks as Array<Record<string, unknown>> : [];
    if (!entries.some((entry) => entry.type === "command" && entry.command === deps.hookCommand)) {
      first.hooks = [...entries, commandHook(deps.hookCommand)];
      if (groups.length === 0) groups.push(first);
      updatedHooks[name] = groups;
      changed = true;
    }
  }
  if (!changed) return { changed: false, entries: [...CLAUDE_CODE_HOOKS] };
  const updatedText = applyEdits(text, modify(text, ["hooks"], updatedHooks, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  if (deps.dryRun) return { changed: true, entries: [...CLAUDE_CODE_HOOKS] };
  await mkdir(dirname(settingsPath), { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const backupPath = existing === undefined ? null : `${settingsPath}.agent-attention-backup-${(deps.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, "-")}`;
  if (backupPath !== null && existing !== undefined) await writeFile(backupPath, existing);
  await writeFile(settingsPath, updatedText, "utf8");
  const marker: Marker = { settingsPath, hookCommand: deps.hookCommand, backupPath, installedContentSha256: hash(updatedText) };
  await writeFile(markerPath(stateDir), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return { changed: true, backedUpTo: backupPath ?? undefined, entries: [...CLAUDE_CODE_HOOKS] };
}

export async function uninstallClaudeCode(deps: UninstallClaudeCodeDeps): Promise<InstallReport> {
  const settingsPath = resolve(deps.settingsPath);
  const stateDir = resolve(deps.stateDir ?? defaultClaudeCodeStateDir());
  const markerFile = markerPath(stateDir);
  const markerBytes = await readExisting(markerFile);
  const existing = await readExisting(settingsPath);
  if (existing === undefined || markerBytes === undefined) return { changed: false, entries: [] };
  const marker = JSON.parse(markerBytes.toString("utf8")) as Marker;
  const parsed = parse(existing.toString("utf8")) as Record<string, unknown>;
  const hooks = typeof parsed.hooks === "object" && parsed.hooks !== null && !Array.isArray(parsed.hooks) ? parsed.hooks as Record<string, unknown> : {};
  const updatedHooks = structuredClone(hooks) as Record<string, unknown>;
  for (const name of CLAUDE_CODE_HOOKS) {
    const groups = Array.isArray(updatedHooks[name]) ? updatedHooks[name] as Array<Record<string, unknown>> : [];
    updatedHooks[name] = groups.map((group) => ({ ...group, hooks: Array.isArray(group.hooks) ? (group.hooks as Array<Record<string, unknown>>).filter((entry) => !(entry.type === "command" && entry.command === deps.hookCommand)) : group.hooks }));
  }
  const updatedText = applyEdits(existing.toString("utf8"), modify(existing.toString("utf8"), ["hooks"], updatedHooks, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  await writeFile(settingsPath, updatedText, "utf8");
  await rm(markerFile, { force: true });
  if (deps.purge && marker.backupPath !== null) await rm(marker.backupPath, { force: true });
  return { changed: true, entries: [...CLAUDE_CODE_HOOKS] };
}
