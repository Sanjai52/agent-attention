/**
 * Shim spool fallback (PRD.md §9.2, S2-06).
 *
 * One event per file. The file is written under a temporary name, fsynced,
 * then atomically renamed to `<13-digit epoch ms>-<6-digit pid>-<8 hex>.jsonl`,
 * so a visible `.jsonl` is always complete. The host ingests visible files in
 * filename order and deletes each only after the event is committed.
 */

import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@agent-attention/contract";

export const SPOOL_FILE_PATTERN = /^\d{13}-\d{6}-[0-9a-f]{8}\.jsonl$/;

/** `%LOCALAPPDATA%\AgentAttention\spool` (PRD §9.2). */
export function defaultSpoolDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(root, "AgentAttention", "spool");
}

export function spoolFileName(
  nowMs: number = Date.now(),
  pid: number = process.pid,
  random: string = randomBytes(4).toString("hex"),
): string {
  const epoch = String(Math.max(0, Math.floor(nowMs))).padStart(13, "0");
  const processId = String(pid).padStart(6, "0");
  return `${epoch}-${processId}-${random}.jsonl`;
}

/**
 * Write one event atomically. Returns the final path. Throws only when the
 * spool cannot be written; callers treat that as a failed fallback.
 */
export function appendSpool(event: AgentEvent, dir: string = defaultSpoolDir()): string {
  mkdirSync(dir, { recursive: true });

  const name = spoolFileName();
  const finalPath = join(dir, name);
  const tempPath = join(dir, `.${name}.tmp`);
  const payload = `${JSON.stringify(event)}\n`;
  const descriptor = openSync(tempPath, "w");

  try {
    writeSync(descriptor, payload, undefined, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  renameSync(tempPath, finalPath);
  return finalPath;
}

export interface ParsedSpoolFile {
  /** Complete lines only; a torn final line is excluded. */
  lines: string[];
  /** True when the file does not end with a newline (host died mid-write). */
  torn: boolean;
}

/**
 * Split a spool file into complete JSONL lines. A partially written final line
 * is tolerated and reported so the host can retain the file for the next
 * start instead of losing or quarantining it (RF3).
 */
export function parseSpoolLines(content: string): ParsedSpoolFile {
  if (content.length === 0) {
    return { lines: [], torn: false };
  }

  const torn = !content.endsWith("\n");
  const segments = content.split("\n");
  if (!torn) {
    segments.pop(); // trailing empty segment after the final newline
  } else {
    segments.pop(); // torn final segment
  }

  return { lines: segments.filter((line) => line.trim().length > 0), torn };
}
