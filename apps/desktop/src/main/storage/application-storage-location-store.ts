import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import {
  APPLICATION_DATA_DIRECTORY_NAME,
  APPLICATION_HOME_ENVIRONMENT_VARIABLE,
  LEGACY_APPLICATION_HOME_ENVIRONMENT_VARIABLE,
  applicationStorageLocationSchema,
  type ApplicationStorageLocation,
  type ApplicationStorageLocationSource,
} from "@agent/protocol";
import { z } from "zod";

import {
  readJsonConfiguration,
  writeJsonConfiguration,
} from "../settings/json-configuration-file.js";

const storageLocationPreferenceSchema = z.object({
  customPath: z.string().min(1).nullable(),
  version: z.literal(1),
}).strict();

type StorageLocationPreference = z.infer<typeof storageLocationPreferenceSchema>;

const DEFAULT_PREFERENCE: StorageLocationPreference = {
  customPath: null,
  version: 1,
};

type ResolvedLocation = {
  configurationError: boolean;
  path: string;
  source: ApplicationStorageLocationSource;
};

export class ApplicationStorageLocationStore {
  private readonly activePath: string;
  private readonly configurationPath: string;
  private readonly defaultPath: string;
  private readonly environmentPath: string | null;

  public constructor(input: {
    configurationPath: string;
    environment?: NodeJS.ProcessEnv;
    homeDirectory: string;
  }) {
    this.configurationPath = path.resolve(input.configurationPath);
    this.defaultPath = path.join(
      path.resolve(input.homeDirectory),
      APPLICATION_DATA_DIRECTORY_NAME,
    );
    this.environmentPath = resolveEnvironmentPath(input.environment);
    this.activePath = this.resolveConfiguredLocation().path;
  }

  public getStartupPath(): string {
    return this.activePath;
  }

  public getLocation(): ApplicationStorageLocation {
    const configured = this.resolveConfiguredLocation();
    return applicationStorageLocationSchema.parse({
      activePath: this.activePath,
      canChange: this.environmentPath === null,
      configuredPath: configured.path,
      configurationError: configured.configurationError,
      defaultPath: this.defaultPath,
      restartRequired: !pathsEqual(this.activePath, configured.path),
      source: configured.source,
    });
  }

  public selectLocation(selectedPath: string): ApplicationStorageLocation {
    this.assertCanChange();
    if (!path.isAbsolute(selectedPath)) {
      throw new Error("软件数据存储目录必须是绝对路径。");
    }
    const canonicalPath = realpathSync(selectedPath);
    if (!statSync(canonicalPath).isDirectory()) {
      throw new Error("选择的软件数据存储位置不是目录。");
    }
    this.writePreference(pathsEqual(canonicalPath, this.defaultPath) ? null : canonicalPath);
    return this.getLocation();
  }

  public resetLocation(): ApplicationStorageLocation {
    this.assertCanChange();
    this.writePreference(null);
    return this.getLocation();
  }

  private assertCanChange(): void {
    if (this.environmentPath !== null) {
      throw new Error(
        `软件数据目录由 ${APPLICATION_HOME_ENVIRONMENT_VARIABLE} 或 ${LEGACY_APPLICATION_HOME_ENVIRONMENT_VARIABLE} 环境变量控制。`,
      );
    }
  }

  private readPreference(): {
    configurationError: boolean;
    value: StorageLocationPreference;
  } {
    if (!existsSync(this.configurationPath)) {
      return { configurationError: false, value: structuredClone(DEFAULT_PREFERENCE) };
    }
    try {
      const value = readJsonConfiguration(
        this.configurationPath,
        storageLocationPreferenceSchema,
        DEFAULT_PREFERENCE,
      );
      if (value.customPath !== null && !path.isAbsolute(value.customPath)) {
        return { configurationError: true, value: structuredClone(DEFAULT_PREFERENCE) };
      }
      if (value.customPath !== null) {
        const canonicalPath = realpathSync(value.customPath);
        if (!statSync(canonicalPath).isDirectory()) {
          return { configurationError: true, value: structuredClone(DEFAULT_PREFERENCE) };
        }
        value.customPath = canonicalPath;
      }
      return { configurationError: false, value };
    } catch {
      return { configurationError: true, value: structuredClone(DEFAULT_PREFERENCE) };
    }
  }

  private resolveConfiguredLocation(): ResolvedLocation {
    if (this.environmentPath !== null) {
      return {
        configurationError: false,
        path: this.environmentPath,
        source: "environment",
      };
    }
    const preference = this.readPreference();
    return {
      configurationError: preference.configurationError,
      path: preference.value.customPath === null
        ? this.defaultPath
        : path.resolve(preference.value.customPath),
      source: preference.value.customPath === null ? "default" : "custom",
    };
  }

  private writePreference(customPath: string | null): void {
    mkdirSync(path.dirname(this.configurationPath), { recursive: true, mode: 0o700 });
    writeJsonConfiguration(
      this.configurationPath,
      storageLocationPreferenceSchema,
      { customPath, version: 1 },
    );
  }
}

function resolveEnvironmentPath(environment: NodeJS.ProcessEnv | undefined): string | null {
  const primaryPath = environment?.[APPLICATION_HOME_ENVIRONMENT_VARIABLE]?.trim();
  const legacyPath = environment?.[LEGACY_APPLICATION_HOME_ENVIRONMENT_VARIABLE]?.trim();
  const configuredPath = primaryPath || legacyPath;
  if (configuredPath === undefined || configuredPath.length === 0) return null;
  if (!path.isAbsolute(configuredPath)) {
    throw new Error(
      `${primaryPath ? APPLICATION_HOME_ENVIRONMENT_VARIABLE : LEGACY_APPLICATION_HOME_ENVIRONMENT_VARIABLE} 必须是绝对路径。`,
    );
  }
  return path.resolve(configuredPath);
}

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}
