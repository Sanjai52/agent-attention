import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PURE_PACKAGES = ["packages/contract/src", "packages/core/src"];
const FORBIDDEN = [
  /from ["']node:fs["']/,
  /from ["']node:child_process["']/,
  /from ["']node:net["']/,
  /from ["']node:http["']/,
  /process\.exit/,
  /setTimeout\(/,
  /setInterval\(/,
];

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? collect(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("core and contract purity", () => {
  it.each(PURE_PACKAGES)("%s contains no I/O or timer calls", (pkg) => {
    const offenders = collect(pkg)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return FORBIDDEN.some((pattern) => pattern.test(source));
      });
    expect(offenders).toEqual([]);
  });
});
