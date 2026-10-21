import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  // The published CLI must not resolve workspace packages back to their
  // TypeScript source files. Bundle them into the executable artifact.
  noExternal: [/^@agent-attention\//],
});
