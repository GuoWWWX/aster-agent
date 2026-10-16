import { fileURLToPath, URL } from "node:url";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Electron loads the production renderer through file:// rather than an HTTP origin.
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        nativeOverlay: fileURLToPath(new URL("native-overlay.html", import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      "@agent/protocol": fileURLToPath(
        new URL("../../packages/protocol/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    headers: {
      "X-Aster-Workspace": createHash("sha256").update(realpathSync(fileURLToPath(new URL("../../", import.meta.url)))).digest("hex"),
    },
  },
});
