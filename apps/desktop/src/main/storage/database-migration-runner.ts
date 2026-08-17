import type { DatabaseSync } from "node:sqlite";

type MigrationDatabase = DatabaseSync;

export type DatabaseMigration = {
  name: string;
  up: (database: MigrationDatabase) => void;
  version: number;
};

type MigrationRow = Record<string, unknown>;

const SCHEMA_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`;

function readMigrationVersion(row: MigrationRow): number {
  const version = row.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version <= 0) {
    throw new Error("Stored schema migration version is invalid.");
  }
  return version;
}

function readTableColumns(database: MigrationDatabase): Set<string> {
  const rows = database.prepare("PRAGMA table_info(schema_migrations)").all() as MigrationRow[];
  return new Set(
    rows.flatMap((row) => (typeof row.name === "string" ? [row.name] : [])),
  );
}

export class DatabaseMigrationRunner {
  public constructor(private readonly database: MigrationDatabase) {}

  public run(migrations: readonly DatabaseMigration[]): void {
    this.validateMigrations(migrations);
    this.database.exec(SCHEMA_MIGRATIONS_TABLE);
    const columns = readTableColumns(this.database);
    if (!["version", "name", "applied_at"].every((column) => columns.has(column))) {
      throw new Error("The schema_migrations table has an incompatible schema.");
    }

    const knownVersions = new Set(migrations.map((migration) => migration.version));
    const latestKnownVersion = Math.max(...knownVersions, 0);
    const appliedRows = this.database
      .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
      .all() as MigrationRow[];
    const appliedVersions = new Set(appliedRows.map(readMigrationVersion));
    const latestAppliedVersion = Math.max(...appliedVersions, 0);
    if (latestAppliedVersion > latestKnownVersion) {
      throw new Error(
        `Database schema version ${latestAppliedVersion} is newer than supported version ${latestKnownVersion}.`,
      );
    }
    for (const version of appliedVersions) {
      if (!knownVersions.has(version)) {
        throw new Error(`Database schema migration version ${version} is not supported.`);
      }
    }
    for (const migration of migrations) {
      if (migration.version > latestAppliedVersion) break;
      if (!appliedVersions.has(migration.version)) {
        throw new Error(
          `Database schema migration history is incomplete before version ${latestAppliedVersion}.`,
        );
      }
    }

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      this.runOne(migration);
      appliedVersions.add(migration.version);
    }
  }

  private runOne(migration: DatabaseMigration): void {
    // The initial migration may rebuild a legacy table with foreign-key references.
    // Toggle enforcement outside the transaction so SQLite accepts that rebuild.
    this.database.exec("PRAGMA foreign_keys = OFF;");
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      migration.up(this.database);
      this.database
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
      this.database.exec("COMMIT;");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch (rollbackError) {
        throw new Error("Database migration failed and could not be rolled back.", {
          cause: rollbackError,
        });
      }
      throw error;
    } finally {
      this.database.exec("PRAGMA foreign_keys = ON;");
    }
  }

  private validateMigrations(migrations: readonly DatabaseMigration[]): void {
    let previousVersion = 0;
    const versions = new Set<number>();
    if (migrations.length > 0 && migrations[0]?.version !== 1) {
      throw new Error("Database migrations must start at version 1.");
    }
    for (const migration of migrations) {
      if (
        !Number.isSafeInteger(migration.version) ||
        migration.version <= 0 ||
        versions.has(migration.version) ||
        migration.version <= previousVersion ||
        migration.name.trim().length === 0
      ) {
        throw new Error("Database migrations must have unique, strictly increasing versions.");
      }
      previousVersion = migration.version;
      versions.add(migration.version);
    }
  }
}
