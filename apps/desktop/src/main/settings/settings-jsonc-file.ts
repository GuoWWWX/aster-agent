import { existsSync, readFileSync } from "node:fs";

import { APPLICATION_DISPLAY_NAME } from "@agent/protocol";

import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";

import { writeTextDocument } from "./json-configuration-file.js";

type ValueSchema<T> = {
  parse(value: unknown): T;
};

const FORMATTING_OPTIONS: FormattingOptions = {
  eol: "\n",
  insertSpaces: true,
  tabSize: 2,
};

const DEFAULT_DOCUMENT = `{
  // ${APPLICATION_DISPLAY_NAME} 全局配置。支持 JSONC 注释和尾逗号。
  "version": 1,
}
`;

type SettingsDocument = Record<string, unknown> & { version: 1 };

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class SettingsJsoncFile {
  public constructor(public readonly path: string) {}

  public ensureFile(): void {
    if (!existsSync(this.path)) writeTextDocument(this.path, DEFAULT_DOCUMENT);
    this.readDocument();
  }

  public has(key: string): boolean {
    return Object.hasOwn(this.readDocument(), key);
  }

  public readValue(key: string): unknown {
    return clone(this.readDocument()[key]);
  }

  public read<T>(key: string, schema: ValueSchema<T>, defaultValue: T): T {
    const value = this.readDocument()[key];
    return value === undefined ? clone(defaultValue) : schema.parse(value);
  }

  public write<T>(key: string, schema: ValueSchema<T>, value: T): T {
    const parsed = schema.parse(value);
    this.writeValues([{ key, value: parsed }]);
    return clone(parsed);
  }

  public writeValues(values: readonly { key: string; value: unknown }[]): void {
    this.ensureFile();
    let content = readFileSync(this.path, "utf8");
    for (const { key, value } of values) {
      content = applyEdits(content, modify(content, [key], value, {
        formattingOptions: FORMATTING_OPTIONS,
      }));
    }
    parseDocument(this.path, content);
    writeTextDocument(this.path, content.endsWith("\n") ? content : `${content}\n`);
  }

  private readDocument(): SettingsDocument {
    this.ensureDocumentExists();
    return parseDocument(this.path, readFileSync(this.path, "utf8"));
  }

  private ensureDocumentExists(): void {
    if (!existsSync(this.path)) writeTextDocument(this.path, DEFAULT_DOCUMENT);
  }
}

function parseDocument(configurationPath: string, content: string): SettingsDocument {
  const errors: ParseError[] = [];
  const value: unknown = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const first = errors[0];
    if (first === undefined) throw new Error(`Unable to parse settings: ${configurationPath}`);
    throw new Error(
      `Unable to parse settings ${configurationPath} at offset ${first.offset}: ${printParseErrorCode(first.error)}`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${APPLICATION_DISPLAY_NAME} settings must be a JSONC object: ${configurationPath}`);
  }
  const version = (value as Record<string, unknown>).version;
  if (version !== 1) {
    throw new Error(`Unsupported ${APPLICATION_DISPLAY_NAME} settings version: ${String(version)}`);
  }
  return value as SettingsDocument;
}
