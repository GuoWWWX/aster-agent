import concurrently from "concurrently";
import { pathToFileURL } from "node:url";

export function devCommands(rendererUrl = "http://127.0.0.1:5173") {
  const url = new URL(rendererUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) throw new Error("Development Renderer must use a local HTTP origin.");
  const port = url.port || "80";
  return [
    { name: "web", command: `pnpm --filter @agent/web dev --port ${port} --strictPort` },
    { name: "desktop", command: `wait-on tcp:127.0.0.1:${port} && pnpm --filter @agent/desktop dev` },
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { result } = concurrently(devCommands(process.env.ELECTRON_RENDERER_URL), {
    killOthersOn: ["failure"], prefixColors: ["cyan", "green"],
  });
  result.catch(() => { process.exitCode = 1; });
}
