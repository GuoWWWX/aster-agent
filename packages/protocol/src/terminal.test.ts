import { describe, expect, it } from "vitest";

import { DEFAULT_TERMINAL_CONFIGURATION, terminalConfigurationSchema } from "./terminal.js";

describe("terminalConfigurationSchema", () => {
  it("keeps saved terminal settings compatible when shell paths are absent", () => {
    const legacyConfiguration: Record<string, unknown> = structuredClone(
      DEFAULT_TERMINAL_CONFIGURATION,
    );
    delete legacyConfiguration.shellPaths;

    expect(terminalConfigurationSchema.parse(legacyConfiguration)).toEqual(
      DEFAULT_TERMINAL_CONFIGURATION,
    );
  });
});
