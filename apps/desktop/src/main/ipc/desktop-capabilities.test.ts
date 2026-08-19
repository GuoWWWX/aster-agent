import { describe, expect, it } from "vitest";

import { DESKTOP_CAPABILITIES } from "./desktop-capabilities.js";

describe("desktop capabilities", () => {
  it("reports controlled process and Skill execution capabilities", () => {
    expect(DESKTOP_CAPABILITIES).toMatchObject({
      fileWrite: true,
      git: false,
      managedBrowser: false,
      mcp: false,
      process: true,
      pty: false,
      skills: true,
      workspace: true,
    });
  });
});
