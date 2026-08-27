import { existsSync } from "node:fs";

import {
  applicationSettingsSchema,
  DEFAULT_APPLICATION_SETTINGS,
  type ApplicationSettings,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";

export class ApplicationSettingsStore {
  private readonly listeners = new Set<(configuration: ApplicationSettings) => void>();

  public constructor(private readonly configurationPath: string) {}

  public onChanged(listener: (configuration: ApplicationSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

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
    const saved = writeJsonConfiguration(this.configurationPath, applicationSettingsSchema, input);
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(saved));
      } catch (error) {
        console.error("Application settings change listener failed.", error);
      }
    }
    return saved;
  }
}
