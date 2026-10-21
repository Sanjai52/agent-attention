import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Resolve platform assets from source packages and from consumers that bundle
 * this package into another workspace package such as the host or CLI.
 */
export function resolvePlatformResource(
  relativePath: string,
  moduleUrl: string = import.meta.url,
): string {
  const moduleDir = fileURLToPath(new URL(".", moduleUrl));
  const candidates = [
    path.join(moduleDir, "..", relativePath),
    path.join(moduleDir, "..", "..", "platform-windows", relativePath),
    path.join(moduleDir, "..", "..", "packages", "platform-windows", relativePath),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}
