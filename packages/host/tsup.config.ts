import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/main.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  // The packaged host must run with `node dist/main.js`, so workspace packages
  // whose local `main` points at TypeScript source are bundled in. Built-ins
  // such as `node:sqlite` remain external.
  noExternal: [/^@agent-attention\//],
  external: ["node:sqlite"],
});
