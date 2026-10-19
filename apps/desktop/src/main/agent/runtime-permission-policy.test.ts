import { describe, expect, it } from "vitest";

import { runtimeToolPermissionCategory, unavailableRuntimeToolReason } from "./runtime-permission-policy.js";

type CategoryCase = {
  toolName: string;
  category: "ask" | "computer-control" | "command-run" | "browser-control" | "patch-write" | "workspace-read" | "workspace-search" | null;
  unavailableReason: string;
};
const genericReason = "该工具已在应用权限设置中禁用。";
const cases: CategoryCase[] = [
  ...["generate_images", "web_search"].map(toolName => ({ toolName, category: "ask" as const, unavailableReason: genericReason })),
  { toolName: "computer_use", category: "computer-control", unavailableReason: genericReason },
  ...["run_command", "terminal_control", "create_terminal", "open_terminal", "execute_terminal_command"]
    .map(toolName => ({ toolName, category: "command-run" as const, unavailableReason: "终端命令执行已在应用权限设置中禁用。" })),
  ...["browser_control", "browser_open", "browser_navigate", "browser_click", "browser_fill", "browser_select_option", "browser_key", "browser_scroll", "browser_close"]
    .map(toolName => ({ toolName, category: "browser-control" as const, unavailableReason: "浏览器模型操作已在应用权限设置中禁用。" })),
  ...["write_file", "delete_file", "replace_in_file", "apply_patch"]
    .map(toolName => ({ toolName, category: "patch-write" as const, unavailableReason: "文件变更已在应用权限设置中禁用。" })),
  { toolName: "create_skill", category: "patch-write", unavailableReason: genericReason },
  ...["present_html", "read_file", "view_image", "view_attachments"]
    .map(toolName => ({ toolName, category: "workspace-read" as const, unavailableReason: "工作区读取已在应用权限设置中禁用。" })),
  ...["find_files", "search_text"]
    .map(toolName => ({ toolName, category: "workspace-search" as const, unavailableReason: "工作区搜索已在应用权限设置中禁用。" })),
  ...["read_external_file", "external_read", "send_agent_message", "git_write", "unknown_tool"]
    .map(toolName => ({ toolName, category: null, unavailableReason: genericReason })),
];

describe("Runtime tool permission categories", () => {
  it.each(cases)("preserves the configured policy family for $toolName", ({ toolName, category }) => {
    expect(runtimeToolPermissionCategory(toolName)).toBe(category);
  });

  it.each(cases)("preserves the exact disabled explanation for $toolName", ({ toolName, unavailableReason }) => {
    expect(unavailableRuntimeToolReason(toolName, "unavailable")).toBe(unavailableReason);
  });

  it.each(["allow", "ask"] as const)("does not show a disabled explanation under %s", policy => {
    for (const { toolName } of cases) expect(unavailableRuntimeToolReason(toolName, policy)).toBeNull();
  });
});
