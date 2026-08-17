import { existsSync } from "node:fs";

import {
  contextCompressionConfigurationSchema,
  DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  type ContextCompressionConfiguration,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";

export class ContextCompressionConfigurationStore {
  public constructor(private readonly configurationPath: string) {}

  public ensureFile(): void {
    if (!existsSync(this.configurationPath)) {
      this.saveConfiguration(DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION);
    }
  }

  public getConfiguration(): ContextCompressionConfiguration {
    return readJsonConfiguration(
      this.configurationPath,
      contextCompressionConfigurationSchema,
      DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
    );
  }

  public saveConfiguration(
    input: ContextCompressionConfiguration,
  ): ContextCompressionConfiguration {
    return writeJsonConfiguration(this.configurationPath, contextCompressionConfigurationSchema, input);
  }
}
