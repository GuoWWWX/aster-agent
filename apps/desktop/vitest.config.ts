import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [{
    enforce: "pre",
    name: "raw-markdown",
    transform(source, id) {
      if (!id.endsWith(".md")) return null;
      return {
        code: `export default ${JSON.stringify(source)};`,
        map: null
      };
    }
  }],
  resolve: {
    alias: {
      "@agent/protocol": fileURLToPath(
        new URL("../../packages/protocol/src/index.ts", import.meta.url)
      )
    }
  }
});
