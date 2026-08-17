import {
  integrationConfigurationSchema,
  type IntegrationConfiguration,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";

const EMPTY_CONFIGURATION: IntegrationConfiguration = {
  mcpServers: [],
  skillDirectories: [],
  skills: [],
  version: 1,
};

export class IntegrationConfigurationStore {
  public constructor(private readonly configurationPath: string) {}

  public getConfiguration(): IntegrationConfiguration {
    return readJsonConfiguration(
      this.configurationPath,
      integrationConfigurationSchema,
      EMPTY_CONFIGURATION,
    );
  }

  public saveConfiguration(input: IntegrationConfiguration): IntegrationConfiguration {
    return writeJsonConfiguration(this.configurationPath, integrationConfigurationSchema, input);
  }
}
