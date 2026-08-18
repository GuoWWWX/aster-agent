import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agent/protocol": fileURLToPath(
        new URL("../../packages/protocol/src/index.ts", import.meta.url)
      )
    }
  }
});
