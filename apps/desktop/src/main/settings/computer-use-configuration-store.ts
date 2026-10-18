import { realpathSync, statSync } from "node:fs";
import { computerUseConfigurationSchema, DEFAULT_COMPUTER_USE_CONFIGURATION, type ComputerUseConfiguration } from "@agent/protocol";
import { SettingsJsoncFile } from "./settings-jsonc-file.js";

export class ComputerUseConfigurationStore {
  public constructor(private readonly settings: SettingsJsoncFile) {}
  public getConfiguration(): ComputerUseConfiguration {
    return this.settings.read("computerUse", computerUseConfigurationSchema, DEFAULT_COMPUTER_USE_CONFIGURATION);
  }
  public saveConfiguration(input: ComputerUseConfiguration): ComputerUseConfiguration {
    const parsed = computerUseConfigurationSchema.parse(input);
    for (const application of parsed.applications) {
      if (!statSync(application.executablePath).isFile()) throw new Error("请选择已存在的软件可执行文件。");
      application.executablePath = realpathSync(application.executablePath);
    }
    return this.settings.write("computerUse", computerUseConfigurationSchema, parsed);
  }
}
