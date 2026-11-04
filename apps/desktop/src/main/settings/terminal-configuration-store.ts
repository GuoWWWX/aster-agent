import {
  DEFAULT_TERMINAL_CONFIGURATION,
  terminalConfigurationSchema,
  type TerminalConfiguration,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";
import { SettingsJsoncFile } from "./settings-jsonc-file.js";

const PREVIOUS_DEFAULT_FONT_FAMILIES = new Set([
  "Cascadia Mono, Consolas, 'Microsoft YaHei UI', monospace",
  "'CodeNewRoman Nerd Font Mono', 'Cascadia Mono', 'Segoe UI Emoji', 'Microsoft YaHei UI', Consolas, monospace",
]);

export class TerminalConfigurationStore {
  public constructor(
    private readonly configuration: string | SettingsJsoncFile,
    private readonly legacyConfigurationPath?: string,
  ) {}

  public getConfiguration(): TerminalConfiguration {
    if (
      this.configuration instanceof SettingsJsoncFile
      && !this.configuration.has("terminal")
      && this.legacyConfigurationPath !== undefined
      && existsSync(this.legacyConfigurationPath)
    ) {
      this.saveConfiguration(readJsonConfiguration(
        this.legacyConfigurationPath,
        terminalConfigurationSchema,
        DEFAULT_TERMINAL_CONFIGURATION,
      ));
    }
    const configuration = this.configuration instanceof SettingsJsoncFile
      ? (() => {
          const value = this.configuration.readValue("terminal");
          return value === undefined
            ? structuredClone(DEFAULT_TERMINAL_CONFIGURATION)
            : terminalConfigurationSchema.parse({ ...(value as object), version: 1 });
        })()
      : readJsonConfiguration(
          this.configuration,
          terminalConfigurationSchema,
          DEFAULT_TERMINAL_CONFIGURATION,
        );
    return PREVIOUS_DEFAULT_FONT_FAMILIES.has(configuration.fontFamily)
      ? { ...configuration, fontFamily: DEFAULT_TERMINAL_CONFIGURATION.fontFamily }
      : configuration;
  }

  public saveConfiguration(input: TerminalConfiguration): TerminalConfiguration {
    const parsed = terminalConfigurationSchema.parse(input);
    if (this.configuration instanceof SettingsJsoncFile) {
      const stored = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key !== "version"),
      );
      this.configuration.writeValues([{ key: "terminal", value: stored }]);
      return structuredClone(parsed);
    }
    return writeJsonConfiguration(this.configuration, terminalConfigurationSchema, parsed);
  }
}
import { existsSync } from "node:fs";
