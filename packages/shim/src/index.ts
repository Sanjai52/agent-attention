/**
 * Hook shim entry point (PRD.md §9.2, Task 2.6).
 *
 * A hook adapter pipes one normalized event JSON document to this process; the
 * shim sends it to the host or spools it, then exits 0. Nothing is written to
 * stdout because the host may interpret it.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runShimFromStdin, type RunShimOptions } from "./client";

export * from "./client";
export * from "./spawn-host";
export * from "./spool";

export async function main(options: RunShimOptions = {}): Promise<number> {
  return runShimFromStdin(options);
}

const entry = process.argv[1];
const isDirectRun =
  entry !== undefined && resolve(entry) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
