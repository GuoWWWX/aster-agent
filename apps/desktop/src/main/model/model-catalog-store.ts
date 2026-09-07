import { existsSync } from "node:fs";

import {
  DEFAULT_MODEL_CATALOG,
  modelCatalogSchema,
  type ModelCatalog,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "../settings/json-configuration-file.js";
import { SettingsJsoncFile } from "../settings/settings-jsonc-file.js";

/** Persists user-maintained model defaults separately from encrypted credentials. */
export class ModelCatalogStore {
  public constructor(
    private readonly configuration: string | SettingsJsoncFile,
    private readonly legacyConfigurationPath?: string,
  ) {}

  public ensureFile(): void {
    if (this.configuration instanceof SettingsJsoncFile) {
      this.configuration.ensureFile();
      if (!this.configuration.has("modelCatalog")) {
        const initial = this.legacyConfigurationPath !== undefined
          && existsSync(this.legacyConfigurationPath)
          ? readJsonConfiguration(
              this.legacyConfigurationPath,
              modelCatalogSchema,
              DEFAULT_MODEL_CATALOG,
            )
          : DEFAULT_MODEL_CATALOG;
        this.writeCatalog(initial);
      }
      return;
    }
    if (!existsSync(this.configuration)) {
      this.writeCatalog(DEFAULT_MODEL_CATALOG);
    }
  }

  public getCatalog(): ModelCatalog {
    this.ensureFile();
    if (this.configuration instanceof SettingsJsoncFile) {
      const value = this.configuration.readValue("modelCatalog");
      return modelCatalogSchema.parse({ ...(value as object), version: 1 });
    }
    return readJsonConfiguration(
      this.configuration,
      modelCatalogSchema,
      DEFAULT_MODEL_CATALOG,
    );
  }

  private writeCatalog(catalog: ModelCatalog): void {
    const parsed = modelCatalogSchema.parse(catalog);
    if (this.configuration instanceof SettingsJsoncFile) {
      const stored = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key !== "version"),
      );
      this.configuration.writeValues([{ key: "modelCatalog", value: stored }]);
      return;
    }
    writeJsonConfiguration(this.configuration, modelCatalogSchema, parsed);
  }
}
