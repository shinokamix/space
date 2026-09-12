import { createRuntimeServer } from "./server.js";

const port = Number(process.env.SPACE_RUNTIME_PORT ?? 4310);
const token = process.env.SPACE_RUNTIME_TOKEN;

if (!token) throw new Error("SPACE_RUNTIME_TOKEN is required");

try {
  const server = createRuntimeServer({ token });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void server.shutdown().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
    shutdown();
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (typeof address === "string" || address === null) {
      server.close();
      throw new Error("Runtime did not receive a TCP port");
    }
    console.log(`Space runtime listening on http://127.0.0.1:${address.port}`);
    process.send?.({ type: "space.runtime.ready", port: address.port });
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
