import {
  DEFAULT_TERMINAL_CONFIGURATION,
  terminalConfigurationSchema,
  type TerminalConfiguration,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";

const PREVIOUS_DEFAULT_FONT_FAMILIES = new Set([
  "Cascadia Mono, Consolas, 'Microsoft YaHei UI', monospace",
  "'CodeNewRoman Nerd Font Mono', 'Cascadia Mono', 'Segoe UI Emoji', 'Microsoft YaHei UI', Consolas, monospace",
]);

export class TerminalConfigurationStore {
  public constructor(private readonly configurationPath: string) {}

  public getConfiguration(): TerminalConfiguration {
    const configuration = readJsonConfiguration(
      this.configurationPath,
      terminalConfigurationSchema,
      DEFAULT_TERMINAL_CONFIGURATION,
    );
    return PREVIOUS_DEFAULT_FONT_FAMILIES.has(configuration.fontFamily)
      ? { ...configuration, fontFamily: DEFAULT_TERMINAL_CONFIGURATION.fontFamily }
      : configuration;
  }

  public saveConfiguration(input: TerminalConfiguration): TerminalConfiguration {
    return writeJsonConfiguration(this.configurationPath, terminalConfigurationSchema, input);
  }
}
