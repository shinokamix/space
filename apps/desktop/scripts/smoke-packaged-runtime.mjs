import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const platformDirectory = {
  darwin: `mac-${process.arch}`,
  linux: `linux-${process.arch}-unpacked`,
  win32: `win-${process.arch}-unpacked`,
}[process.platform];

if (!platformDirectory) throw new Error(`Unsupported platform: ${process.platform}`);

const executable =
  process.platform === "darwin"
    ? join("release", platformDirectory, "Space.app", "Contents", "MacOS", "Space")
    : process.platform === "win32"
      ? join("release", platformDirectory, "Space.exe")
      : join("release", platformDirectory, "space");

const resources =
  process.platform === "darwin"
    ? join("release", platformDirectory, "Space.app", "Contents", "Resources")
    : join("release", platformDirectory, "resources");
const entry = join(resources, "app.asar", "node_modules", "@space", "runtime", "dist", "main.js");

const reservePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("Failed to reserve a runtime smoke-test port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const temporaryDirectory = await mkdtemp(join(tmpdir(), "space-packaged-runtime-"));
const port = await reservePort();
const child = spawn(executable, [entry], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    SPACE_DATABASE_PATH: join(temporaryDirectory, "space.db"),
    SPACE_RUNTIME_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  const deadline = Date.now() + 10_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged runtime exited with code ${child.exitCode}\n${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const health = await response.json();
        if (health.status !== "ok")
          throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
        console.log(`Packaged runtime smoke test passed on port ${port}`);
        ready = true;
        break;
      }
    } catch {
      // The runtime may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!ready) throw new Error(`Packaged runtime did not become ready\n${output}`);
} finally {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
  await rm(temporaryDirectory, { recursive: true, force: true });
}
