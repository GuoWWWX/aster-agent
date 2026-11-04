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
    const previous = this.configuration instanceof SettingsJsoncFile && !this.configuration.has("integrations")
      ? EMPTY_CONFIGURATION : this.getConfiguration();
    for (const skill of previous.skills.filter(skill => skill.origin === "system")) {
      const next = parsed.skills.find(candidate => candidate.id === skill.id);
      if (next === undefined || JSON.stringify({ ...next, enabled: false }) !== JSON.stringify({ ...skill, enabled: false })) {
        throw new Error("系统 Skill 只读，只能启用或停用，不能修改或移除配置。");
      }
    }
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
