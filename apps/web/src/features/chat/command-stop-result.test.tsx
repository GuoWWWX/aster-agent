import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CommandLifecycleResult } from "./workspace-content.js";

describe("command stop receipt", () => {
  it.each([null, "2026-09-08T00:00:00.000Z"])("never renders logs or a nested terminal (completedAt=%s)", (completedAt) => {
    const html = renderToStaticMarkup(<CommandLifecycleResult mode="stop" status="completed" payload={JSON.stringify({
      ok: true, value: { command: {
        commandId: "test", status: "cancelled", completedAt, exitCode: null, error: null,
        stdout: "PRIVATE_LOG".repeat(10000), stderr: "PRIVATE_ERROR", command: "PRIVATE_COMMAND",
      } },
    })} />);
    expect(html).toContain(completedAt === null ? "已发送停止请求" : "后台命令已停止");
    expect(html).not.toContain("PRIVATE_");
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("<section");
    expect(html.length).toBeLessThan(400);
  });
  it("preserves necessary errors", () => {
    const html = renderToStaticMarkup(<CommandLifecycleResult mode="stop" status="completed" payload={JSON.stringify({
      ok: true, value: { command: { commandId: "test", status: "failed", completedAt: "done", error: "启动失败" } },
    })} />);
    expect(html).toContain("无需再次停止");
    expect(html).toContain("启动失败");
  });
});
