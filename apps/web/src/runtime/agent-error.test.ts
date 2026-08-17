import { AgentClientError } from "@agent/protocol";
import { describe, expect, it } from "vitest";

import { getUserErrorMessage } from "./agent-error.js";

describe("renderer error messages", () => {
  it("shows structured errors with their correlation id", () => {
    const reason = new AgentClientError({
      code: "PERMISSION_DENIED",
      id: "123e4567-e89b-42d3-a456-426614174000",
      message: "没有权限执行这项操作。",
      retryable: false,
    });

    expect(getUserErrorMessage(reason, "操作失败")).toContain(
      "123e4567-e89b-42d3-a456-426614174000",
    );
  });

  it("does not expose undecorated Electron errors", () => {
    expect(
      getUserErrorMessage(
        new Error("Error invoking remote method 'project:list': internal stack"),
        "读取项目失败",
      ),
    ).toBe("读取项目失败");
  });

  it("keeps local validation messages", () => {
    expect(getUserErrorMessage(new Error("JSON 配置无效。"), "操作失败")).toBe(
      "JSON 配置无效。",
    );
  });
});
