import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vite-plus/test";

import { EnvironmentInUseError, openRuntimeDatabase } from "./database.js";

describe("database migration", () => {
  it("creates the terminal sessions table", async () => {
    const directory = await mkdtemp(join(tmpdir(), "space-database-test-"));
    const filename = join(directory, "space.db");
    try {
      const runtimeDatabase = openRuntimeDatabase(filename);
      runtimeDatabase.close();

      const database = new DatabaseSync(filename, { readOnly: true });
      try {
        const rows = database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?) ORDER BY name",
          )
          .all("command_receipts", "terminal_sessions");
        expect(rows).toEqual([{ name: "command_receipts" }, { name: "terminal_sessions" }]);
      } finally {
        database.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the environment ID when the database reopens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "space-database-test-"));
    const filename = join(directory, "space.db");
    try {
      const first = openRuntimeDatabase(filename);
      const environmentId = first.environmentId;
      first.close();

      const second = openRuntimeDatabase(filename);
      expect(second.environmentId).toBe(environmentId);
      second.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows only one runtime owner for a database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "space-database-test-"));
    const filename = join(directory, "space.db");
    try {
      const first = openRuntimeDatabase(filename);
      expect(() => openRuntimeDatabase(filename)).toThrow(EnvironmentInUseError);
      first.close();

      const nextOwner = openRuntimeDatabase(filename);
      nextOwner.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("removes a lock left by a crashed process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "space-database-test-"));
    const filename = join(directory, "space.db");
    const lockDirectory = `${filename}.runtime-lock`;
    try {
      await mkdir(lockDirectory);
      await writeFile(
        join(lockDirectory, "owner.json"),
        JSON.stringify({ token: "stale", pid: 2_147_483_647 }),
      );

      const database = openRuntimeDatabase(filename);
      expect(database.environmentId).toEqual(expect.any(String));
      database.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("normalizes a legacy receipt cwd before comparing its payload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "space-database-test-"));
    const filename = join(directory, "space.db");
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE terminal_sessions (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        shell TEXT NOT NULL,
        cols INTEGER NOT NULL,
        rows INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        exited_at TEXT,
        exit_reason TEXT,
        exit_code INTEGER
      );
      CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY,
        command_type TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES terminal_sessions(id),
        created_at TEXT NOT NULL
      );
      INSERT INTO terminal_sessions
        (id, cwd, shell, cols, rows, status, started_at, exited_at, exit_reason)
      VALUES
        ('session-1', '.', '/bin/sh', 100, 30, 'exited', '2026-09-12T00:00:00Z',
         '2026-09-12T00:01:00Z', 'process-exit');
      INSERT INTO command_receipts (command_id, command_type, session_id, created_at)
      VALUES ('command-1', 'terminal.create', 'session-1', '2026-09-12T00:00:00Z');
    `);
    legacy.close();

    try {
      const database = openRuntimeDatabase(filename);
      const result = database.createTerminal({
        commandId: "command-1",
        sessionId: "unused-session",
        cwd: process.cwd(),
        shell: "/bin/sh",
        cols: 100,
        rows: 30,
        startedAt: "2026-09-12T00:02:00Z",
        commandPayload: JSON.stringify({ cwd: process.cwd(), shell: "/bin/sh" }),
      });
      expect(result).toMatchObject({ created: false, session: { id: "session-1" } });
      database.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
