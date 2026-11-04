

export type DatabaseRow = Record<string, unknown>;

export function asString(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Database column ${key} is not a string.`);
  }
  return value;
}

export function asNullableString(row: DatabaseRow, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Database column ${key} is not nullable text.`);
  }
  return value;
}

export function asBoolean(row: DatabaseRow, key: string): boolean {
  const value = row[key];
  if (value === 0 || value === false) return false;
  if (value === 1 || value === true) return true;
  throw new Error(`Database column ${key} is not a boolean.`);
}

export function asNullableNumber(row: DatabaseRow, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new Error(`Database column ${key} is not a nullable number.`);
  }
  return value;
}

export function asNumber(row: DatabaseRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") {
    throw new Error(`Database column ${key} is not a number.`);
  }
  return value;
}

export function parseJson<T>(value: string, description: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Stored ${description} is invalid JSON.`);
  }
}

export function parseStoredStringArray(value: string, description: string): string[] {
  const parsed = parseJson<unknown>(value, description);
  if (!Array.isArray(parsed)) {
    throw new Error(`Stored ${description} is not a string array.`);
  }
  const strings: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") {
      throw new Error(`Stored ${description} is not a string array.`);
    }
    strings.push(entry);
  }
  return [...new Set(strings)];
}
