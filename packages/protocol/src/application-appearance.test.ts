import { describe, expect, it } from "vitest";

import { applicationAppearanceConfigurationSchema, DEFAULT_APPLICATION_SETTINGS } from "./application-settings.js";

describe("settings navigation appearance", () => {
  it("restores typography defaults for an older configuration without replacing its theme", () => {
    const legacy = { ...DEFAULT_APPLICATION_SETTINGS.appearance, themeMode: "dark" };
    for (const field of ["uiFontSize", "chatFontSize", "codeFontSize"]) Reflect.deleteProperty(legacy, field);
    expect(applicationAppearanceConfigurationSchema.parse(legacy)).toMatchObject({
      themeMode: "dark", uiFontSize: 13, chatFontSize: 13, codeFontSize: 11,
    });
  });

  it.each([
    ["uiFontSize", 11], ["uiFontSize", 19], ["chatFontSize", 25],
    ["codeFontSize", 9], ["chatFontSize", 13.5], ["codeFontSize", "14"],
  ])("rejects invalid %s: %s", (field, value) => {
    expect(applicationAppearanceConfigurationSchema.safeParse({
      ...DEFAULT_APPLICATION_SETTINGS.appearance, [field]: value,
    }).success).toBe(false);
  });

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
