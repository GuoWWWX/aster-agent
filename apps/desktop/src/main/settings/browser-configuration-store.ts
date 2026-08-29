import {
  browserConfigurationSchema,
  DEFAULT_BROWSER_CONFIGURATION,
  type BrowserConfiguration,
} from "@agent/protocol";

import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";

export class BrowserConfigurationStore {
  public constructor(private readonly configurationPath: string) {}

  public getConfiguration(): BrowserConfiguration {
    return readJsonConfiguration(
      this.configurationPath,
      browserConfigurationSchema,
      DEFAULT_BROWSER_CONFIGURATION,
    );
  }

  public saveConfiguration(input: BrowserConfiguration): BrowserConfiguration {
    return writeJsonConfiguration(this.configurationPath, browserConfigurationSchema, input);
  }
}
