/**
 * Spool ingestion (PRD.md §9.2, §14.2, Task 2.7).
 *
 * Rules from S2 / D-03:
 * - visible files are processed in filename order (the epoch prefix is order);
 * - every line goes through the normal pipeline, so dedupe applies;
 * - a file is deleted only after all its complete lines are committed;
 * - malformed lines are counted and the file is quarantined as
 *   `*.rejected.jsonl`, while its valid lines are still ingested;
 * - a torn final line means the host died mid-write: complete lines are
 *   ingested and the file is retained for the next start (RF3), not deleted or
 *   quarantined.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { AgentEvent } from "@agent-attention/contract";
import type { ProcessingResult } from "@agent-attention/core";

import type { SpoolIngestSummary } from "./lifecycle";

export interface ParsedSpoolFile {
  lines: string[];
  torn: boolean;
}

export function parseSpoolContent(content: string): ParsedSpoolFile {
  if (content.length === 0) {
    return { lines: [], torn: false };
  }

  const torn = !content.endsWith("\n");
  const segments = content.split("\n");
  segments.pop();
  return { lines: segments.filter((line) => line.trim().length > 0), torn };
}

function isVisibleSpoolFile(name: string): boolean {
  return name.endsWith(".jsonl") && !name.endsWith(".rejected.jsonl") && !name.startsWith(".");
}

function quarantinePath(file: string): string {
  const base = file.endsWith(".jsonl") ? file.slice(0, -".jsonl".length) : file;
  let candidate = `${base}.rejected.jsonl`;
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = `${base}.rejected-${suffix}.jsonl`;
    suffix += 1;
  }
  return candidate;
}

export type SpoolSubmit = (event: AgentEvent) => Promise<ProcessingResult>;

/**
 * Ingest every visible spool file once, in filename order. Never throws for
 * malformed input or a failed submit; a submit failure retains the file so the
 * next host start can retry it (the pipeline dedupes replayed events).
 */
export async function ingestSpool(dir: string, submit: SpoolSubmit): Promise<SpoolIngestSummary> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter(isVisibleSpoolFile).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ingested: 0, rejected: 0 };
    }
    throw error;
  }

  let ingested = 0;
  let rejected = 0;

  for (const name of names) {
    const file = join(dir, name);
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    const parsed = parseSpoolContent(content);
    let rejectedLines = 0;
    let submitFailed = false;

    for (const line of parsed.lines) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        rejectedLines += 1;
        continue;
      }

      try {
        const result = await submit(value as AgentEvent);
        if (result.status === "rejected") {
          rejectedLines += 1;
        } else {
          ingested += 1;
        }
      } catch {
        submitFailed = true;
        break;
      }
    }

    rejected += rejectedLines;

    if (parsed.torn || submitFailed) {
      // Retain for the next start; dedupe makes a replay safe.
      continue;
    }

    if (rejectedLines > 0) {
      try {
        await rename(file, quarantinePath(file));
      } catch {
        // A failed quarantine must not lose the file or crash the host.
      }
      continue;
    }

    try {
      await unlink(file);
    } catch {
      // If deletion fails, the replay is deduplicated next start.
    }
  }

  return { ingested, rejected };
}
