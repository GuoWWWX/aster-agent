import { existsSync } from "node:fs";

import {
  DEFAULT_MODEL_CATALOG,
  modelCatalogSchema,
  type ModelCatalog,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "../settings/json-configuration-file.js";

/** Persists user-maintained model defaults separately from encrypted credentials. */
export class ModelCatalogStore {
  public constructor(private readonly configurationPath: string) {}

  public ensureFile(): void {
    if (!existsSync(this.configurationPath)) {
      this.writeCatalog(DEFAULT_MODEL_CATALOG);
    }
  }

  public getCatalog(): ModelCatalog {
    this.ensureFile();
    return readJsonConfiguration(
      this.configurationPath,
      modelCatalogSchema,
      DEFAULT_MODEL_CATALOG,
    );
  }

  private writeCatalog(catalog: ModelCatalog): void {
    writeJsonConfiguration(this.configurationPath, modelCatalogSchema, catalog);
  }
}
