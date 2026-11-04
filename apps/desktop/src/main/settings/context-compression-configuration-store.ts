import { existsSync } from "node:fs";

import {
  contextCompressionConfigurationSchema,
  DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  type ContextCompressionConfiguration,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";
import { SettingsJsoncFile } from "./settings-jsonc-file.js";

export class ContextCompressionConfigurationStore {
  public constructor(
    private readonly configuration: string | SettingsJsoncFile,
    private readonly legacyConfigurationPath?: string,
  ) {}

  public ensureFile(): void {
    if (this.configuration instanceof SettingsJsoncFile) {
      this.configuration.ensureFile();
      if (!this.configuration.has("contextCompression")) {
        const initial = this.legacyConfigurationPath !== undefined
          && existsSync(this.legacyConfigurationPath)
          ? readJsonConfiguration(
              this.legacyConfigurationPath,
              contextCompressionConfigurationSchema,
              DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
            )
          : DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION;
        this.saveConfiguration(initial);
      }
      return;
    }
    if (!existsSync(this.configuration)) {
      this.saveConfiguration(DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION);
    }
  }

  public getConfiguration(): ContextCompressionConfiguration {
    if (this.configuration instanceof SettingsJsoncFile) {
      const value = this.configuration.readValue("contextCompression");
      return value === undefined
        ? structuredClone(DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION)
        : contextCompressionConfigurationSchema.parse({ ...(value as object), version: 1 });
    }
    return readJsonConfiguration(
      this.configuration,
      contextCompressionConfigurationSchema,
      DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
    );
  }

  public saveConfiguration(
    input: ContextCompressionConfiguration,
  ): ContextCompressionConfiguration {
    const parsed = contextCompressionConfigurationSchema.parse(input);
    if (this.configuration instanceof SettingsJsoncFile) {
      const stored = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key !== "version"),
      );
      this.configuration.writeValues([{ key: "contextCompression", value: stored }]);
      return structuredClone(parsed);
    }
    return writeJsonConfiguration(this.configuration, contextCompressionConfigurationSchema, parsed);
  }
}
