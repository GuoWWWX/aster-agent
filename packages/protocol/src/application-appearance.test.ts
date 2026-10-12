import { describe, expect, it } from "vitest";

import { applicationAppearanceConfigurationSchema, DEFAULT_APPLICATION_SETTINGS } from "./application-settings.js";

describe("settings navigation appearance", () => {
  it("adds the default width to older appearance settings", () => {
    const legacy = { ...DEFAULT_APPLICATION_SETTINGS.appearance };
    Reflect.deleteProperty(legacy, "settingsNavigationWidth");
    expect(applicationAppearanceConfigurationSchema.parse(legacy)).toMatchObject({
      ...legacy, settingsNavigationWidth: 240,
    });
  });

  it.each([200, 240, 360])("accepts a saved width of %i", (settingsNavigationWidth) => {
    expect(applicationAppearanceConfigurationSchema.parse({
      ...DEFAULT_APPLICATION_SETTINGS.appearance, settingsNavigationWidth,
    }).settingsNavigationWidth).toBe(settingsNavigationWidth);
  });

  it.each([199, 361, 240.5, "240"])("rejects invalid width %s", (settingsNavigationWidth) => {
    expect(applicationAppearanceConfigurationSchema.safeParse({
      ...DEFAULT_APPLICATION_SETTINGS.appearance, settingsNavigationWidth,
    }).success).toBe(false);
  });
});
