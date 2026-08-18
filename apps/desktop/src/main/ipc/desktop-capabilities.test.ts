import { describe, expect, it } from "vitest";

import { DESKTOP_CAPABILITIES } from "./desktop-capabilities.js";

describe("desktop capabilities", () => {
  it("reports controlled process execution without advertising unfinished runtimes", () => {
    expect(DESKTOP_CAPABILITIES).toMatchObject({
      fileWrite: true,
      git: false,
      managedBrowser: false,
      mcp: false,
      process: true,
      pty: false,
      skills: false,
      workspace: true,
    });
  });
});
