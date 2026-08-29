import { describe, expect, it } from "vitest";

import {
  AGENT_AVATAR_PICKER_PAGE_SIZE,
  filterAgentAvatarIconOptions,
  paginateAgentAvatarIconOptions,
} from "./agent-avatar-picker.js";

describe("AgentAvatarPicker", () => {
  it("searches icons by localized label and stable ID", () => {
    expect(filterAgentAvatarIconOptions("工作流").map((option) => option.id)).toEqual(["workflow"]);
    expect(filterAgentAvatarIconOptions("git-branch").map((option) => option.label)).toEqual(["版本控制"]);
    expect(filterAgentAvatarIconOptions("  ")).toHaveLength(63);
  });

  it("paginates the shared icon catalog and clamps stale pages", () => {
    const options = filterAgentAvatarIconOptions("");
    const firstPage = paginateAgentAvatarIconOptions(options, 1);
    const lastPage = paginateAgentAvatarIconOptions(options, 99);

    expect(firstPage.items).toHaveLength(AGENT_AVATAR_PICKER_PAGE_SIZE);
    expect(firstPage.totalPages).toBe(3);
    expect(lastPage.page).toBe(3);
    expect(lastPage.items).toHaveLength(15);
  });
});
