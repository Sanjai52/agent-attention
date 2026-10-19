import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageAliases = {
  "@agent-attention/contract": "packages/contract/src/index.ts",
  "@agent-attention/core": "packages/core/src/index.ts",
  "@agent-attention/storage": "packages/storage/src/index.ts",
  "@agent-attention/notifications": "packages/notifications/src/index.ts",
  "@agent-attention/platform-windows": "packages/platform-windows/src/index.ts",
  "@agent-attention/host": "packages/host/src/index.ts",
  "@agent-attention/shim": "packages/shim/src/index.ts",
  "@agent-attention/cli": "packages/cli/src/index.ts",
  "@agent-attention/adapter-opencode": "adapters/opencode/src/index.ts",
  "@agent-attention/adapter-claude-code": "adapters/claude-code/src/index.ts",
  "@agent-attention/adapter-codex": "adapters/codex/src/index.ts",
  "@agent-attention/adapter-gemini-cli": "adapters/gemini-cli/src/index.ts",
} as const;

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      Object.entries(packageAliases).map(([name, path]) => [
        name,
        fileURLToPath(new URL(path, import.meta.url)),
      ]),
    ),
  },
  test: {
    environment: "node",
    include: [
      "packages/**/test/**/*.test.ts",
      "adapters/**/test/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    passWithNoTests: true,
  },
});
