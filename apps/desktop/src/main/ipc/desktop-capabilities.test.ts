import { describe, expect, it } from "vitest";

import { DESKTOP_CAPABILITIES } from "./desktop-capabilities.js";

describe("desktop capabilities", () => {
  it("reports controlled process and Skill execution capabilities", () => {
    expect(DESKTOP_CAPABILITIES).toMatchObject({
      fileWrite: true,
      git: true,
      managedBrowser: true,
      mcp: false,
      process: true,
      pty: true,
      skills: true,
      workspace: true,
    });
  });
});
