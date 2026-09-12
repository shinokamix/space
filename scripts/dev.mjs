import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

const reservePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("Failed to reserve a development runtime port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const port = await reservePort();
const token = randomBytes(32).toString("base64url");
const env = {
  ...process.env,
  SPACE_RUNTIME_PORT: String(port),
  SPACE_RUNTIME_TOKEN: token,
};
const command = process.platform === "win32" ? "vp.cmd" : "vp";
const mode = process.argv[2] ?? "all";
if (mode !== "all" && mode !== "runtime") throw new Error(`Unknown development mode: ${mode}`);
if (mode === "runtime") {
  console.log(`Runtime: http://127.0.0.1:${port}`);
  console.log(`SPACE_RUNTIME_TOKEN=${token}`);
}
const tasks = ["@space/runtime#dev"];
if (mode === "all") tasks.push("@space/desktop#dev");
const children = tasks.map((task) => spawn(command, ["run", task], { env, stdio: "inherit" }));

let stopping = false;
const stop = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
};

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(signal));
for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
    stop();
  });
  child.once("exit", (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
}
