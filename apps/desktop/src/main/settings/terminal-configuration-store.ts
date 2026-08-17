import {
  DEFAULT_TERMINAL_CONFIGURATION,
  terminalConfigurationSchema,
  type TerminalConfiguration,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";

export class TerminalConfigurationStore {
  public constructor(private readonly configurationPath: string) {}

  public getConfiguration(): TerminalConfiguration {
    return readJsonConfiguration(
      this.configurationPath,
      terminalConfigurationSchema,
      DEFAULT_TERMINAL_CONFIGURATION,
    );
  }

  public saveConfiguration(input: TerminalConfiguration): TerminalConfiguration {
    return writeJsonConfiguration(this.configurationPath, terminalConfigurationSchema, input);
  }
}
