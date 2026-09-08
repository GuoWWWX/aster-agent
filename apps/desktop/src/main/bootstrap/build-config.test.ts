import { describe, expect, it } from "vitest";

import config from "../../../tsup.config.js";

describe("desktop build configuration", () => {
  it("preserves prefix-only Node builtins for Electron", () => {
    expect(config).toHaveProperty("external", ["electron", "node:sqlite"]);
    expect(config).toHaveProperty("removeNodeProtocol", false);
  });
});
