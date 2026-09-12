import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

interface SpaceWindow {
  readonly space: {
    readonly getRuntimeConfig: () => Promise<{ readonly token: string; readonly url: string }>;
  };
}

const reservePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("Failed to reserve an E2E runtime port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

const waitForExit = (child: ChildProcess, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    if (hasExited(child)) {
      resolve(true);
      return;
    }
    const exited = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const finish = (didExit: boolean) => {
      clearTimeout(timeout);
      child.off("exit", exited);
      resolve(didExit);
    };
    child.once("exit", exited);
    if (hasExited(child)) finish(true);
  });

const stopProcess = async (child: ChildProcess) => {
  if (!hasExited(child)) child.kill();
  if (await waitForExit(child, 5_000)) return;
  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
};

test("creates a working terminal from the canvas menu", async () => {
  const directory = await mkdtemp(join(tmpdir(), "space-e2e-"));
  const port = await reservePort();
  const token = randomBytes(32).toString("base64url");
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      SPACE_DATABASE_PATH: join(directory, "space.db"),
      SPACE_RUNTIME_PORT: String(port),
      SPACE_RUNTIME_TOKEN: token,
    }).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined,
    ),
  );
  const runtime = spawn(process.execPath, [join("..", "runtime", "dist", "main.js")], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await expect
      .poll(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { authorization: `Bearer ${token}` },
          });
          return response.ok;
        } catch {
          return false;
        }
      })
      .toBe(true);

    application = await electron.launch({ args: ["."], cwd: process.cwd(), env });
    const window = await application.firstWindow();
    const canvas = window.getByRole("region", { name: "Workspace canvas" });
    await canvas.click({ button: "right", position: { x: 240, y: 180 } });
    await window.getByRole("menuitem", { name: "Terminal" }).click();
    await expect(window.getByRole("article", { name: "Terminal" })).toBeVisible();
    const rendererHealth = await window.evaluate(async () => {
      const config = await (globalThis as unknown as SpaceWindow).space.getRuntimeConfig();
      try {
        const response = await fetch(`${config.url}/health`, {
          headers: { authorization: `Bearer ${config.token}` },
        });
        return { body: (await response.json()) as unknown, status: response.status };
      } catch (error) {
        return { error: String(error) };
      }
    });
    expect(rendererHealth).toEqual({
      body: {
        status: "ok",
        version: "0.1.0",
        environmentId: expect.any(String),
      },
      status: 200,
    });
    await window.getByRole("textbox", { name: "Terminal input" }).click();
    await window.keyboard.type("echo SPACE_E2E_READY");
    await window.keyboard.press("Enter");
    await expect(window.getByText(/SPACE_E2E_READY/).first()).toBeVisible();

    await window.keyboard.type("exit");
    await window.keyboard.press("Enter");
    const restart = window.getByRole("button", { name: "Restart terminal" });
    await expect(restart).toBeVisible();
    await restart.click();
    await expect(restart).not.toBeVisible();
    await window.getByRole("textbox", { name: "Terminal input" }).click();
    await window.keyboard.type("echo SPACE_E2E_RESTARTED");
    await window.keyboard.press("Enter");
    await expect(window.getByText(/SPACE_E2E_RESTARTED/).first()).toBeVisible();
  } finally {
    await application?.close();
    await stopProcess(runtime);
    await rm(directory, { recursive: true, force: true });
  }
});
