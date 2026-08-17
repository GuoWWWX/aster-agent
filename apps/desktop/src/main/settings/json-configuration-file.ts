import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

type JsonSchema<T> = {
  parse(value: unknown): T;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function configurationReadError(configurationPath: string, cause: unknown): Error {
  const error = new Error(`Unable to read JSON configuration file: ${configurationPath}`, {
    cause,
  });
  const code = cause !== null && typeof cause === "object" && "code" in cause
    ? (cause as { code?: unknown }).code
    : undefined;
  if (typeof code === "string") (error as NodeJS.ErrnoException).code = code;
  return error;
}

export function readJsonConfiguration<T>(
  configurationPath: string,
  schema: JsonSchema<T>,
  defaultValue: T,
): T {
  if (!existsSync(configurationPath)) return clone(defaultValue);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configurationPath, "utf8"));
  } catch (error) {
    throw configurationReadError(configurationPath, error);
  }
  return schema.parse(parsed);
}

export function writeJsonConfiguration<T>(
  configurationPath: string,
  schema: JsonSchema<T>,
  input: T,
): T {
  const parsed = schema.parse(input);
  writeJsonDocument(configurationPath, parsed);
  return clone(parsed);
}

export function readJsonDocument(configurationPath: string): unknown {
  if (!existsSync(configurationPath)) {
    throw Object.assign(
      new Error(`JSON configuration file does not exist: ${configurationPath}`),
      { code: "ENOENT" },
    );
  }
  try {
    return JSON.parse(readFileSync(configurationPath, "utf8"));
  } catch (error) {
    throw configurationReadError(configurationPath, error);
  }
}

export function writeJsonDocument(configurationPath: string, value: unknown): void {
  const temporaryPath = `${configurationPath}.${process.pid}.${randomUUID()}.tmp`;
  let failure: unknown = null;
  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, configurationPath);
  } catch (error) {
    failure = error;
  }
  try {
    unlinkSync(temporaryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && failure === null) {
      failure = error;
    }
  }
  if (failure !== null) {
    throw asError(failure);
  }
}
