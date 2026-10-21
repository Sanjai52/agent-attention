/**
 * Executable entry point for the Notification Host (Task 2.5).
 *
 * The host is started by the shim with `detached: true, windowsHide: true,
 * stdio: "ignore"`, so this module must not require a console and must not
 * write machine-interpretable data to stdout.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runHost } from "./lifecycle";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return runHost(argv);
}

const entry = process.argv[1];
const isDirectRun =
  entry !== undefined && resolve(entry) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
