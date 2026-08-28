import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "main/index": "src/main/bootstrap/index.ts",
    "preload/index": "src/preload/index.ts"
  },
  clean: true,
  dts: false,
  external: ["electron", "node:sqlite"],
  format: ["cjs"],
  loader: {
    ".md": "text"
  },
  minify: false,
  noExternal: ["@agent/protocol", "zod"],
  outDir: "dist",
  outExtension: () => ({
    js: ".cjs"
  }),
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node22"
});
