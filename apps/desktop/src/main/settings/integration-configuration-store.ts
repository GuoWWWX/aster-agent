import {
  integrationConfigurationSchema,
  type IntegrationConfiguration,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";
import { SettingsJsoncFile } from "./settings-jsonc-file.js";

const EMPTY_CONFIGURATION: IntegrationConfiguration = {
  mcpServers: [],
  skillDirectories: [],
  skills: [],
  version: 1,
};

export class IntegrationConfigurationStore {
  public constructor(
    private readonly configuration: string | SettingsJsoncFile,
    private readonly legacyConfigurationPath?: string,
  ) {}

  public getConfiguration(): IntegrationConfiguration {
    if (this.configuration instanceof SettingsJsoncFile) {
      if (
        !this.configuration.has("integrations")
        && this.legacyConfigurationPath !== undefined
        && existsSync(this.legacyConfigurationPath)
      ) {
        this.saveConfiguration(readJsonConfiguration(
          this.legacyConfigurationPath,
          integrationConfigurationSchema,
          EMPTY_CONFIGURATION,
        ));
      }
      const value = this.configuration.readValue("integrations");
      return value === undefined
        ? structuredClone(EMPTY_CONFIGURATION)
        : integrationConfigurationSchema.parse({ ...(value as object), version: 1 });
    }
    return readJsonConfiguration(
      this.configuration,
      integrationConfigurationSchema,
      EMPTY_CONFIGURATION,
    );
  }

  public saveConfiguration(input: IntegrationConfiguration): IntegrationConfiguration {
    const parsed = integrationConfigurationSchema.parse(input);
    if (this.configuration instanceof SettingsJsoncFile) {
      const stored = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key !== "version"),
      );
      this.configuration.writeValues([{ key: "integrations", value: stored }]);
      return structuredClone(parsed);
    }
    return writeJsonConfiguration(this.configuration, integrationConfigurationSchema, parsed);
  }
}
import { existsSync } from "node:fs";
