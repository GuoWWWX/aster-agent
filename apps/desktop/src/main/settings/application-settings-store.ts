import { existsSync } from "node:fs";

import {
  applicationSettingsSchema,
  DEFAULT_APPLICATION_SETTINGS,
  type ApplicationSettings,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";

export class ApplicationSettingsStore {
  public constructor(private readonly configurationPath: string) {}

  public ensureFile(): void {
    if (!existsSync(this.configurationPath)) {
      this.saveConfiguration(DEFAULT_APPLICATION_SETTINGS);
    }
  }

  public getConfiguration(): ApplicationSettings {
    return readJsonConfiguration(
      this.configurationPath,
      applicationSettingsSchema,
      DEFAULT_APPLICATION_SETTINGS,
    );
  }

  public saveConfiguration(input: ApplicationSettings): ApplicationSettings {
    return writeJsonConfiguration(this.configurationPath, applicationSettingsSchema, input);
  }
}
