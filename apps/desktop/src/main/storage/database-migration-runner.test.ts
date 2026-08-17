import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { DatabaseMigrationRunner } from "./database-migration-runner.js";

describe("DatabaseMigrationRunner", () => {
  it("records a migration and does not run it again", () => {
    const database = new DatabaseSync(":memory:");
    const runner = new DatabaseMigrationRunner(database);
    let executions = 0;
    const migration = {
      name: "create fixture",
      up: () => {
        executions += 1;
        database.exec("CREATE TABLE fixture (value TEXT NOT NULL)");
      },
      version: 1,
    };

    runner.run([migration]);
    runner.run([migration]);

    expect(executions).toBe(1);
    expect(database.prepare("SELECT version, name FROM schema_migrations").all()).toEqual([
      { version: 1, name: "create fixture" },
    ]);
    database.close();
  });

  it("rolls back a failed migration without recording its version", () => {
    const database = new DatabaseSync(":memory:");
    const runner = new DatabaseMigrationRunner(database);

    expect(() =>
      runner.run([
        {
          name: "create fixture",
          up: () => database.exec("CREATE TABLE fixture (value TEXT NOT NULL)"),
          version: 1,
        },
        {
          name: "fail after a side effect",
          up: () => {
            database.exec("CREATE TABLE failed_fixture (value TEXT NOT NULL)");
            throw new Error("fixture migration failed");
          },
          version: 2,
        },
      ]),
    ).toThrow("fixture migration failed");

    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'fixture'").get())
      .toEqual({ name: "fixture" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'failed_fixture'").get())
      .toBeUndefined();
    expect(database.prepare("SELECT version FROM schema_migrations").all()).toEqual([
      { version: 1 },
    ]);
    database.close();
  });

  it("rejects a database created by a newer application version", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (99, 'future', '2026-08-18T00:00:00.000Z');
    `);

    expect(() =>
      new DatabaseMigrationRunner(database).run([
        { name: "current", up: () => undefined, version: 1 },
      ]),
    ).toThrow("newer than supported version 1");
    database.close();
  });

  it("rejects incomplete migration history instead of rerunning an older version", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (2, 'second', '2026-08-18T00:00:00.000Z');
    `);

    expect(() =>
      new DatabaseMigrationRunner(database).run([
        { name: "first", up: () => undefined, version: 1 },
        { name: "second", up: () => undefined, version: 2 },
      ]),
    ).toThrow("migration history is incomplete before version 2");
    database.close();
  });

  it("requires strictly increasing unique migration versions", () => {
    const database = new DatabaseSync(":memory:");
    const runner = new DatabaseMigrationRunner(database);

    expect(() =>
      runner.run([
        { name: "first", up: () => undefined, version: 1 },
        { name: "duplicate", up: () => undefined, version: 1 },
      ]),
    ).toThrow("strictly increasing versions");
    database.close();
  });
});
