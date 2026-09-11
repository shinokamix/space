import { Effect } from "effect";
import { DatabaseLive, migrate } from "./database.js";
import { createRuntimeServer } from "./server.js";

const port = Number(process.env.SPACE_RUNTIME_PORT ?? 4310);

const program = Effect.gen(function* () {
  yield* migrate;
  const server = createRuntimeServer();
  yield* Effect.async<void, Error>((resume) => {
    server.once("error", (error) => resume(Effect.fail(error)));
    server.listen(port, "127.0.0.1", () => {
      console.log(`Space runtime listening on http://127.0.0.1:${port}`);
    });
    return Effect.sync(() => server.close());
  });
}).pipe(Effect.provide(DatabaseLive));

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
