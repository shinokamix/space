import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { DatabaseLive, migrate } from "./database.js";

describe("database migration", () => {
  it("creates the terminal sessions table", async () => {
    const directory = await mkdtemp(join(tmpdir(), "space-database-test-"));
    const filename = join(directory, "space.db");
    const previousFilename = process.env.SPACE_DATABASE_PATH;
    process.env.SPACE_DATABASE_PATH = filename;

    try {
      await Effect.runPromise(Effect.scoped(migrate.pipe(Effect.provide(DatabaseLive))));

      const database = new DatabaseSync(filename, { readOnly: true });
      try {
        const row = database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get("terminal_sessions");
        expect(row).toEqual({ name: "terminal_sessions" });
      } finally {
        database.close();
      }
    } finally {
      if (previousFilename === undefined) delete process.env.SPACE_DATABASE_PATH;
      else process.env.SPACE_DATABASE_PATH = previousFilename;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
