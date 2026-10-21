/**
 * Hook shim entry point (PRD.md §9.2, Task 2.6).
 *
 * A hook adapter pipes one normalized event JSON document to this process; the
 * shim sends it to the host or spools it, then exits 0. Nothing is written to
 * stdout because the host may interpret it.
 */

import { runShimFromStdin, type RunShimOptions } from "./client";

export * from "./client";
export * from "./spawn-host";
export * from "./spool";

export async function main(options: RunShimOptions = {}): Promise<number> {
  return runShimFromStdin(options);
}
