import { DatabaseSync } from "node:sqlite";
import { Context, Effect, Layer } from "effect";

export interface Database {
  readonly exec: (statement: string) => Effect.Effect<void, Error>;
}

export const Database = Context.GenericTag<Database>("@space/runtime/Database");

const openDatabase = Effect.acquireRelease(
  Effect.try({
    try: () => new DatabaseSync(process.env.SPACE_DATABASE_PATH ?? "space.db"),
    catch: (cause) => new Error("Failed to open the Space database", { cause }),
  }),
  (database) => Effect.sync(() => database.close()),
);

export const DatabaseLive = Layer.scoped(
  Database,
  openDatabase.pipe(
    Effect.map((database) => ({
      exec: (statement) =>
        Effect.try({
          try: () => database.exec(statement),
          catch: (cause) => new Error("Failed to execute a Space database statement", { cause }),
        }),
    })),
  ),
);

export const migrate = Effect.gen(function* () {
  const database = yield* Database;

  yield* database.exec(`
    CREATE TABLE IF NOT EXISTS terminal_sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      started_at TEXT NOT NULL,
      exited_at TEXT,
      exit_code INTEGER
    )
  `);
});
