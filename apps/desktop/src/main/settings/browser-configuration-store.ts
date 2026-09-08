import {
  browserConfigurationSchema,
  DEFAULT_BROWSER_CONFIGURATION,
  type BrowserConfiguration,
} from "@agent/protocol";

import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";
import { SettingsJsoncFile } from "./settings-jsonc-file.js";

export class BrowserConfigurationStore {
  public constructor(
    private readonly configuration: string | SettingsJsoncFile,
    private readonly legacyConfigurationPath?: string,
  ) {}

  public getConfiguration(): BrowserConfiguration {
    if (this.configuration instanceof SettingsJsoncFile) {
      if (!this.configuration.has("browser") && this.legacyConfigurationPath !== undefined) {
        const legacy = readJsonConfiguration(
          this.legacyConfigurationPath,
          browserConfigurationSchema,
          DEFAULT_BROWSER_CONFIGURATION,
        );
        if (existsSync(this.legacyConfigurationPath)) this.saveConfiguration(legacy);
      }
      const value = this.configuration.readValue("browser");
      return value === undefined
        ? structuredClone(DEFAULT_BROWSER_CONFIGURATION)
        : browserConfigurationSchema.parse({ ...(value as object), version: 1 });
    }
    return readJsonConfiguration(
      this.configuration,
      browserConfigurationSchema,
      DEFAULT_BROWSER_CONFIGURATION,
    );
  }

  public saveConfiguration(input: BrowserConfiguration): BrowserConfiguration {
    const parsed = browserConfigurationSchema.parse(input);
    if (this.configuration instanceof SettingsJsoncFile) {
      const stored = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key !== "version"),
      );
      this.configuration.writeValues([{ key: "browser", value: stored }]);
      return structuredClone(parsed);
    }
    return writeJsonConfiguration(this.configuration, browserConfigurationSchema, parsed);
  }
}
import { existsSync } from "node:fs";
