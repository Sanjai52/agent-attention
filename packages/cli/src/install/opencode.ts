/**
 * OpenCode install/uninstall mechanics.
 *
 * The installer merges an absolute plugin entry into the user's JSONC config
 * without replacing unrelated keys, comments, or formatting. It writes a
 * timestamped backup and a marker before the first modification so uninstall
 * can restore the original bytes when the user has not edited the file.
 *
 * Toast registration is deliberately not implemented in Phase 3. Windows toast
 * identity/AUMID registration and removal are deferred to Phase 4/6; this
 * module does not fake or claim toast availability.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";
import type {
  InstallOpenCodeDeps,
  InstallReport,
  OpenCodeInstallMarker,
  UninstallOpenCodeDeps,
} from "./types";

const MARKER_FILE_NAME = "opencode.json";
const BACKUP_SUFFIX = ".agent-attention-backup-";

interface ResolvedPaths {
  configPath: string;
  stateDir: string;
  markerPath: string;
}

interface ParsedConfig {
  value: Record<string, unknown>;
  plugins: unknown[] | null;
}

/**
 * Default OpenCode config path: OPENCODE_CONFIG, then XDG_CONFIG_HOME, then
 * ~/.config/opencode/opencode.jsonc.
 */
export function defaultOpenCodeConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const explicit = env.OPENCODE_CONFIG?.trim();
  if (explicit) {
    return explicit;
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) {
    return join(xdgConfigHome, "opencode", "opencode.jsonc");
  }

  return join(home, ".config", "opencode", "opencode.jsonc");
}

/**
 * Default state directory: %LOCALAPPDATA%/AgentAttention/install when
 * available, otherwise ~/.local/share/AgentAttention/install.
 */
export function defaultOpenCodeStateDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData) {
    return join(localAppData, "AgentAttention", "install");
  }

  return join(home, ".local", "share", "AgentAttention", "install");
}

export async function installOpenCode(
  deps: InstallOpenCodeDeps,
): Promise<InstallReport> {
  if (!deps.hostConfigPath.trim()) {
    throw new Error("hostConfigPath is required");
  }
  if (!deps.pluginEntry.trim()) {
    throw new Error("pluginEntry is required");
  }

  const paths = resolvePaths(deps.hostConfigPath, deps.stateDir);
  const existingMarker = await readMarker(paths.markerPath);
  if (existingMarker) {
    assertMarkerConfig(existingMarker, paths.configPath);
    if (existingMarker.pluginEntry !== deps.pluginEntry) {
      throw new Error(
        `Install marker belongs to a different plugin entry: ${existingMarker.pluginEntry}`,
      );
    }
  }

  const existingBytes = await readFileIfExists(paths.configPath);
  const existingText = existingBytes?.toString("utf8") ?? "";
  const parsed = parseConfig(existingText, paths.configPath);
  if (findPluginIndex(parsed.plugins, deps.pluginEntry) >= 0) {
    return { changed: false, entries: [deps.pluginEntry] };
  }

  const updatedText = addPluginEntry(existingText, deps.pluginEntry);
  const installedContentSha256 = sha256(updatedText);
  const now = deps.now ?? (() => new Date());

  if (deps.dryRun) {
    const backupPath =
      existingBytes === null
        ? undefined
        : await chooseBackupPath(paths.configPath, now());
    return report(true, deps.pluginEntry, backupPath);
  }

  // A backup is taken whenever this call actually modifies an existing file.
  // An idempotent call above never reaches this point, so it creates no backup.
  const backupPath =
    existingBytes === null
      ? null
      : await chooseBackupPath(paths.configPath, now());
  const createdConfig = existingBytes === null;

  if (existingBytes !== null && backupPath !== null) {
    await atomicWrite(backupPath, existingBytes);
  }

  const marker: OpenCodeInstallMarker = {
    configPath: paths.configPath,
    pluginEntry: deps.pluginEntry,
    backupPath,
    createdConfig,
    installedContentSha256,
  };

  try {
    await atomicWrite(paths.configPath, updatedText);
    await atomicWrite(
      paths.markerPath,
      `${JSON.stringify(marker, null, 2)}\n`,
    );
  } catch (error) {
    await restoreOnFailedInstall(paths.configPath, existingBytes, backupPath);
    throw error;
  }

  return report(true, deps.pluginEntry, backupPath ?? undefined);
}

export async function uninstallOpenCode(
  deps: UninstallOpenCodeDeps,
): Promise<InstallReport> {
  if (!deps.hostConfigPath.trim()) {
    throw new Error("hostConfigPath is required");
  }

  const paths = resolvePaths(deps.hostConfigPath, deps.stateDir);
  const marker = await readMarker(paths.markerPath);
  if (!marker) {
    return { changed: false, entries: [] };
  }

  assertMarkerConfig(marker, paths.configPath);
  const backupPath = validatedBackupPath(marker, paths.configPath);
  const currentBytes = await readFileIfExists(paths.configPath);

  if (currentBytes !== null) {
    const currentText = currentBytes.toString("utf8");
    const currentHash = sha256(currentBytes);

    if (currentHash === marker.installedContentSha256) {
      if (marker.createdConfig) {
        await rm(paths.configPath, { force: true });
      } else if (backupPath !== null) {
        const backupBytes = await readFileIfExists(backupPath);
        if (backupBytes !== null) {
          await atomicWrite(paths.configPath, backupBytes);
        } else {
          await removeMarkedEntry(paths.configPath, currentText, marker);
        }
      } else {
        await removeMarkedEntry(paths.configPath, currentText, marker);
      }
    } else {
      // The user edited the config after install. Restoring the backup would
      // discard those edits, so remove only the exact entry we added.
      await removeMarkedEntry(paths.configPath, currentText, marker);
    }
  }

  await rm(paths.markerPath, { force: true });

  if (deps.purge) {
    if (backupPath !== null) {
      await rm(backupPath, { force: true });
    }
    // Remove the state directory only when it is empty; unrelated state files
    // and app data are never deleted.
    await rmdir(paths.stateDir).catch(() => undefined);
  }

  return report(true, marker.pluginEntry);
}

function resolvePaths(hostConfigPath: string, stateDir?: string): ResolvedPaths {
  const configPath = resolve(hostConfigPath);
  const resolvedStateDir = resolve(
    stateDir ?? defaultOpenCodeStateDir(),
  );
  const markerPath = join(resolvedStateDir, MARKER_FILE_NAME);
  assertWithin(resolvedStateDir, markerPath, "Install marker path");
  return { configPath, stateDir: resolvedStateDir, markerPath };
}

function assertMarkerConfig(
  marker: OpenCodeInstallMarker,
  configPath: string,
): void {
  if (!samePath(marker.configPath, configPath)) {
    throw new Error(
      `Install marker belongs to a different config: ${marker.configPath}`,
    );
  }
}

function validatedBackupPath(
  marker: OpenCodeInstallMarker,
  configPath: string,
): string | null {
  if (marker.backupPath === null) {
    return null;
  }

  const candidate = resolve(marker.backupPath);
  const expectedPrefix = `${configPath}${BACKUP_SUFFIX}`;
  if (
    !samePath(dirname(candidate), dirname(configPath)) ||
    !normalizedPath(candidate).startsWith(normalizedPath(expectedPrefix))
  ) {
    throw new Error(
      `Install marker backup path is outside the host config directory: ${marker.backupPath}`,
    );
  }

  return candidate;
}

function parseConfig(text: string, configPath: string): ParsedConfig {
  if (text.trim() === "") {
    return { value: {}, plugins: null };
  }

  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;

  if (errors.length > 0) {
    const detail = errors
      .map((error) => `${printParseErrorCode(error.error)} at ${error.offset}`)
      .join(", ");
    throw new Error(
      `OpenCode config is not valid JSONC (${configPath}): ${detail}`,
    );
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OpenCode config must be a JSON object: ${configPath}`);
  }

  const record = value as Record<string, unknown>;
  if ("plugins" in record && !Array.isArray(record.plugins)) {
    throw new Error(
      `OpenCode config "plugins" must be an array: ${configPath}`,
    );
  }

  return {
    value: record,
    plugins: Array.isArray(record.plugins) ? record.plugins : null,
  };
}

function findPluginIndex(plugins: unknown[] | null, pluginEntry: string): number {
  return plugins?.findIndex((entry) => entry === pluginEntry) ?? -1;
}

function addPluginEntry(text: string, pluginEntry: string): string {
  const existingText = text.trim() === "" ? "{}\n" : text;
  const parsed = parseConfig(existingText, "config");
  const formattingOptions = detectFormatting(existingText);

  const edits =
    parsed.plugins === null
      ? modify(existingText, ["plugins"], [pluginEntry], {
          formattingOptions,
        })
      : modify(existingText, ["plugins", -1], pluginEntry, {
          formattingOptions,
        });
  const updated = applyEdits(existingText, edits);

  if (updated === existingText) {
    throw new Error("Failed to merge plugin entry into OpenCode config");
  }

  return updated;
}

async function removeMarkedEntry(
  configPath: string,
  currentText: string,
  marker: OpenCodeInstallMarker,
): Promise<void> {
  const parsed = parseConfig(currentText, configPath);
  const index = findPluginIndex(parsed.plugins, marker.pluginEntry);
  if (index < 0) {
    return;
  }

  const edits = modify(currentText, ["plugins", index], undefined, {
    formattingOptions: detectFormatting(currentText),
  });
  const updated = applyEdits(currentText, edits);
  if (updated !== currentText) {
    await atomicWrite(configPath, updated);
  }
}

function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";

  for (const line of text.split(/\r?\n/)) {
    if (/^\t+/.test(line)) {
      return { insertSpaces: false, tabSize: 1, eol, insertFinalNewline: true };
    }

    const indentation = /^( +)\S/.exec(line)?.[1];
    if (indentation) {
      return {
        insertSpaces: true,
        tabSize: Math.min(indentation.length, 8),
        eol,
        insertFinalNewline: true,
      };
    }
  }

  return { insertSpaces: true, tabSize: 2, eol, insertFinalNewline: true };
}

async function readMarker(
  markerPath: string,
): Promise<OpenCodeInstallMarker | null> {
  const bytes = await readFileIfExists(markerPath);
  if (bytes === null) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Install marker is not valid JSON: ${markerPath}`);
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Install marker has an invalid shape: ${markerPath}`);
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.configPath !== "string" ||
    typeof candidate.pluginEntry !== "string" ||
    (candidate.backupPath !== null &&
      typeof candidate.backupPath !== "string") ||
    typeof candidate.createdConfig !== "boolean" ||
    typeof candidate.installedContentSha256 !== "string"
  ) {
    throw new Error(`Install marker has an invalid shape: ${markerPath}`);
  }

  return {
    configPath: candidate.configPath,
    pluginEntry: candidate.pluginEntry,
    backupPath: candidate.backupPath,
    createdConfig: candidate.createdConfig,
    installedContentSha256: candidate.installedContentSha256,
  };
}

async function chooseBackupPath(
  configPath: string,
  now: Date,
): Promise<string> {
  const baseTime = now.getTime();
  if (Number.isNaN(baseTime)) {
    throw new Error("now() must return a valid Date");
  }

  for (let offset = 0; offset < 120; offset += 1) {
    const candidate = `${configPath}${BACKUP_SUFFIX}${formatTimestamp(
      new Date(baseTime + offset * 1000),
    )}`;
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Unable to choose a backup path for ${configPath}`);
}

function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

async function atomicWrite(
  targetPath: string,
  data: string | Buffer,
): Promise<void> {
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true });

  const tempPath = join(
    directory,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    const handle = await open(tempPath, "wx");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function restoreOnFailedInstall(
  configPath: string,
  existingBytes: Buffer | null,
  backupPath: string | null,
): Promise<void> {
  if (backupPath !== null) {
    await rm(backupPath, { force: true }).catch(() => undefined);
  }

  if (existingBytes !== null) {
    await atomicWrite(configPath, existingBytes).catch(() => undefined);
  } else {
    await rm(configPath, { force: true }).catch(() => undefined);
  }
}

async function readFileIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function report(
  changed: boolean,
  pluginEntry: string,
  backedUpTo?: string,
): InstallReport {
  return {
    changed,
    entries: [pluginEntry],
    ...(backedUpTo ? { backedUpTo } : {}),
  };
}

function assertWithin(parent: string, child: string, label: string): void {
  const relativePath = relative(resolve(parent), resolve(child));
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay within ${parent}`);
  }
}

function samePath(left: string, right: string): boolean {
  return normalizedPath(resolve(left)) === normalizedPath(resolve(right));
}

function normalizedPath(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
